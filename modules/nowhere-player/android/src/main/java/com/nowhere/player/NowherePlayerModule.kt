package com.nowhere.player

import android.app.Activity
import android.content.Intent
import android.net.Uri
import com.spotify.android.appremote.api.ConnectionParams
import com.spotify.android.appremote.api.Connector
import com.spotify.android.appremote.api.SpotifyAppRemote
import com.spotify.protocol.client.CallResult
import com.spotify.protocol.client.Subscription
import com.spotify.protocol.types.Empty
import com.spotify.protocol.types.PlayerState
import com.spotify.sdk.android.auth.AuthorizationClient
import com.spotify.sdk.android.auth.AuthorizationRequest
import com.spotify.sdk.android.auth.AuthorizationResponse
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

class NowherePlayerModule : Module() {
  private var clientId: String = ""
  private var redirectUri: String = "com.nowhere.nowhere://spotify-auth"
  private var accessToken: String? = null
  private var spotifyAppRemote: SpotifyAppRemote? = null
  private var playerStateSubscription: Subscription<PlayerState>? = null
  private var currentTrack: Map<String, Any?>? = null
  private var playbackQueue: List<Map<String, Any?>> = emptyList()
  private var currentQueueIndex: Int = 0
  private var isPlaying: Boolean = false
  private var positionMs: Long = 0L
  private var playbackStatus: String = "idle"
  private var authPromise: Promise? = null
  private var shouldOpenSpotifyAfterAuth: Boolean = false
  private var pendingAutoPlayPrimerUri: String? = null

  override fun definition() = ModuleDefinition {
    Name("NowherePlayer")

    Events("onPlaybackStateChanged")

    OnDestroy {
      playerStateSubscription?.cancel()
      spotifyAppRemote?.let { SpotifyAppRemote.disconnect(it) }
      spotifyAppRemote = null
    }

    OnActivityResult { _: Activity, payload ->
      if (payload.requestCode != SPOTIFY_AUTH_REQUEST_CODE) {
        return@OnActivityResult
      }

      val promise = authPromise ?: return@OnActivityResult
      authPromise = null

      val response = AuthorizationClient.getResponse(payload.resultCode, payload.data)
      when (response.type) {
        AuthorizationResponse.Type.TOKEN -> {
          accessToken = response.accessToken
          if (shouldOpenSpotifyAfterAuth) {
            shouldOpenSpotifyAfterAuth = false
            playbackStatus = "preparingAutoPlay"
            launchSpotifyUri(pendingAutoPlayPrimerUri ?: "spotify:")
            pendingAutoPlayPrimerUri = null
            emitState()
          }
          promise.resolve(
            mapOf(
              "provider" to "spotify",
              "status" to "authorized",
              "authorized" to true,
              "expiresIn" to response.expiresIn
            )
          )
        }
        AuthorizationResponse.Type.ERROR -> {
          shouldOpenSpotifyAfterAuth = false
          pendingAutoPlayPrimerUri = null
          promise.reject("ERR_SPOTIFY_AUTH", response.error ?: "Spotify authorization failed.", null)
        }
        else -> {
          shouldOpenSpotifyAfterAuth = false
          pendingAutoPlayPrimerUri = null
          promise.reject("ERR_SPOTIFY_AUTH_CANCELLED", "Spotify authorization was cancelled.", null)
        }
      }
    }

    AsyncFunction("configureAsync") { options: Map<String, Any?> ->
      applyOptions(options)
      return@AsyncFunction currentState()
    }

    AsyncFunction("requestAuthorizationAsync") { options: Map<String, Any?>, promise: Promise ->
      applyOptions(options)
      val activity = appContext.currentActivity ?: run {
        promise.reject("ERR_ACTIVITY_UNAVAILABLE", "Current Android activity is unavailable.", null)
        return@AsyncFunction
      }

      if (clientId.isBlank()) {
        promise.reject("ERR_SPOTIFY_CLIENT_ID", "Spotify client id is missing.", null)
        return@AsyncFunction
      }

      accessToken?.let {
        promise.resolve(
          mapOf(
            "provider" to "spotify",
            "status" to "authorized",
            "authorized" to true
          )
        )
        return@AsyncFunction
      }

      authPromise = promise
      val request = AuthorizationRequest.Builder(clientId, AuthorizationResponse.Type.TOKEN, redirectUri)
        .setScopes(arrayOf(
          "app-remote-control",
          "streaming",
          "user-read-playback-state",
          "user-modify-playback-state",
          "playlist-read-private",
          "playlist-read-collaborative"
        ))
        .setShowDialog(false)
        .build()
      AuthorizationClient.openLoginActivity(activity, SPOTIFY_AUTH_REQUEST_CODE, request)
    }

    AsyncFunction("connectAsync") { options: Map<String, Any?>, promise: Promise ->
      applyOptions(options)
      connectToSpotify(promise)
    }

    AsyncFunction("searchCatalogAsync") Coroutine { query: String, limit: Int ->
      return@Coroutine searchSpotifyTracks(query, limit.coerceIn(1, 25))
    }

    AsyncFunction("getUserPlaylistsAsync") Coroutine { limit: Int ->
      return@Coroutine getUserSpotifyPlaylists(limit.coerceIn(1, 50))
    }

    AsyncFunction("prepareAutoPlayAsync") { options: Map<String, Any?>, promise: Promise ->
      applyOptions(options)
      @Suppress("UNCHECKED_CAST")
      val primerUri = spotifyUriFrom(options["autoPlayPrimer"] as? Map<String, Any?> ?: emptyMap())
      val activity = appContext.currentActivity ?: run {
        promise.reject("ERR_ACTIVITY_UNAVAILABLE", "Current Android activity is unavailable.", null)
        return@AsyncFunction
      }

      if (clientId.isBlank()) {
        promise.reject("ERR_SPOTIFY_CLIENT_ID", "Spotify client id is missing.", null)
        return@AsyncFunction
      }

      if (accessToken != null) {
        playbackStatus = "preparingAutoPlay"
        launchSpotifyUri(primerUri ?: "spotify:")
        emitState()
        promise.resolve(currentState())
        return@AsyncFunction
      }

      shouldOpenSpotifyAfterAuth = true
      pendingAutoPlayPrimerUri = primerUri
      authPromise = promise
      val request = AuthorizationRequest.Builder(clientId, AuthorizationResponse.Type.TOKEN, redirectUri)
        .setScopes(arrayOf(
          "app-remote-control",
          "streaming",
          "user-read-playback-state",
          "user-modify-playback-state",
          "playlist-read-private",
          "playlist-read-collaborative"
        ))
        .setShowDialog(false)
        .build()
      AuthorizationClient.openLoginActivity(activity, SPOTIFY_AUTH_REQUEST_CODE, request)
    }

    AsyncFunction("playInBackgroundAsync") Coroutine { track: Map<String, Any?>, queue: List<Map<String, Any?>> ->
      val tracks = if (queue.isEmpty()) listOf(track) else queue
      val playableTrack = tracks.firstOrNull() ?: track
      val uri = spotifyUriFrom(playableTrack)
        ?: throw IllegalStateException("A Spotify URI is required before background playback can start.")

      playbackQueue = tracks.mapNotNull { queuedTrack ->
        spotifyUriFrom(queuedTrack)?.let { queuedUri -> mergeTrackPayload(queuedTrack, queuedUri) }
      }
      if (playbackQueue.isEmpty()) {
        playbackQueue = listOf(mergeTrackPayload(playableTrack, uri))
      }
      currentQueueIndex = 0
      currentTrack = playbackQueue.firstOrNull()
      playbackStatus = "loading"
      emitState()

      startSpotifyPlayback(uri, playbackQueue)
      isPlaying = true
      playbackStatus = "playing"
      emitState()
      return@Coroutine currentState()
    }

    AsyncFunction("playAsync") { track: Map<String, Any?>, queue: List<Map<String, Any?>>, promise: Promise ->
      val tracks = if (queue.isEmpty()) listOf(track) else queue
      val playableTrack = tracks.firstOrNull() ?: track
      val uri = spotifyUriFrom(playableTrack)

      if (uri == null) {
        promise.reject("ERR_SPOTIFY_URI", "A Spotify URI is required before playback can start.", null)
        return@AsyncFunction
      }

      playbackQueue = tracks.mapNotNull { queuedTrack ->
        spotifyUriFrom(queuedTrack)?.let { queuedUri -> mergeTrackPayload(queuedTrack, queuedUri) }
      }
      if (playbackQueue.isEmpty()) {
        playbackQueue = listOf(mergeTrackPayload(playableTrack, uri))
      }
      currentQueueIndex = 0
      currentTrack = playbackQueue.firstOrNull()
      isPlaying = true
      playbackStatus = "openedSpotify"

      try {
        launchSpotifyUri(uri)
        emitState()
        promise.resolve(currentState())
      } catch (error: Throwable) {
        promise.reject("ERR_SPOTIFY_OPEN", error.localizedMessage, error)
      }
    }

    AsyncFunction("pauseAsync") { promise: Promise ->
      callPlayer(promise) { it.pause() }
    }

    AsyncFunction("resumeAsync") { promise: Promise ->
      callPlayer(promise) { it.resume() }
    }

    AsyncFunction("stopAsync") { promise: Promise ->
      ensureConnected(
        onReady = {
          val remote = spotifyAppRemote ?: run {
            promise.reject("ERR_SPOTIFY_NOT_CONNECTED", "Spotify App Remote is not connected.", null)
            return@ensureConnected
          }

          remote.playerApi.pause()
            .setResultCallback {
              currentTrack = null
              playbackQueue = emptyList()
              currentQueueIndex = 0
              isPlaying = false
              positionMs = 0L
              playbackStatus = "stopped"
              emitState()
              promise.resolve(currentState())
            }
            .setErrorCallback { error ->
              promise.reject("ERR_SPOTIFY_COMMAND", error.localizedMessage, error)
            }
        },
        onError = { error ->
          promise.reject("ERR_SPOTIFY_CONNECT", error.localizedMessage, error)
        }
      )
    }

    AsyncFunction("skipNextAsync") { promise: Promise ->
      callPlayer(promise, afterSuccess = { advanceQueueIndex(1) }) { it.skipNext() }
    }

    AsyncFunction("skipPreviousAsync") { promise: Promise ->
      callPlayer(promise, afterSuccess = { advanceQueueIndex(-1) }) { it.skipPrevious() }
    }

    AsyncFunction("seekToAsync") { positionMs: Double, promise: Promise ->
      callPlayer(promise) { it.seekTo(positionMs.toLong().coerceAtLeast(0L)) }
    }

    AsyncFunction("getStateAsync") { promise: Promise ->
      val remote = spotifyAppRemote
      if (remote == null || !remote.isConnected) {
        promise.resolve(currentState())
        return@AsyncFunction
      }

      remote.playerApi.playerState
        .setResultCallback { state ->
          updateFromPlayerState(state)
          promise.resolve(currentState())
        }
        .setErrorCallback { error ->
          promise.reject("ERR_SPOTIFY_STATE", error.localizedMessage, error)
        }
    }
  }

  private fun applyOptions(options: Map<String, Any?>) {
    (options["spotifyClientId"] as? String)?.takeIf { it.isNotBlank() }?.let {
      clientId = it
    }
    (options["spotifyRedirectUri"] as? String)?.takeIf { it.isNotBlank() }?.let {
      redirectUri = it
    }
  }

  private fun connectToSpotify(promise: Promise) {
    if (clientId.isBlank()) {
      promise.reject("ERR_SPOTIFY_CLIENT_ID", "Spotify client id is missing.", null)
      return
    }

    ensureConnected(
      onReady = {
        promise.resolve(currentState())
      },
      onError = { error ->
        promise.reject("ERR_SPOTIFY_CONNECT", error.localizedMessage, error)
      }
    )
  }

  private fun ensureConnected(onReady: () -> Unit, onError: (Throwable) -> Unit) {
    val currentRemote = spotifyAppRemote
    if (currentRemote != null && currentRemote.isConnected) {
      onReady()
      return
    }

    val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
    val params = ConnectionParams.Builder(clientId)
      .setRedirectUri(redirectUri)
      .showAuthView(true)
      .build()

    SpotifyAppRemote.connect(
      context,
      params,
      object : Connector.ConnectionListener {
        override fun onConnected(remote: SpotifyAppRemote) {
          spotifyAppRemote = remote
          subscribeToPlayerState(remote)
          onReady()
        }

        override fun onFailure(error: Throwable) {
          onError(error)
        }
      }
    )
  }

  private fun subscribeToPlayerState(remote: SpotifyAppRemote) {
    playerStateSubscription?.cancel()
    playerStateSubscription = remote.playerApi.subscribeToPlayerState()
      .setEventCallback { state ->
        updateFromPlayerState(state)
        emitState()
      }
      .setErrorCallback { error ->
        sendEvent(
          "onPlaybackStateChanged",
          currentState() + mapOf("error" to (error.localizedMessage ?: "Spotify player state error."))
        )
      }
  }

  private fun callPlayer(
    promise: Promise,
    afterSuccess: () -> Unit = {},
    command: (com.spotify.android.appremote.api.PlayerApi) -> CallResult<Empty>
  ) {
    ensureConnected(
      onReady = {
        val remote = spotifyAppRemote ?: run {
          promise.reject("ERR_SPOTIFY_NOT_CONNECTED", "Spotify App Remote is not connected.", null)
          return@ensureConnected
        }

        command(remote.playerApi)
          .setResultCallback {
            afterSuccess()
            emitState()
            promise.resolve(currentState())
          }
          .setErrorCallback { error ->
            promise.reject("ERR_SPOTIFY_COMMAND", error.localizedMessage, error)
          }
      },
      onError = { error ->
        promise.reject("ERR_SPOTIFY_CONNECT", error.localizedMessage, error)
      }
    )
  }

  private suspend fun searchSpotifyTracks(query: String, limit: Int): List<Map<String, Any?>> = withContext(Dispatchers.IO) {
    val token = accessToken ?: throw IllegalStateException("Spotify authorization is required before search.")
    val encodedQuery = URLEncoder.encode(query, StandardCharsets.UTF_8.name())
    val url = URL("https://api.spotify.com/v1/search?type=track&limit=$limit&q=$encodedQuery")
    val connection = (url.openConnection() as HttpURLConnection).apply {
      requestMethod = "GET"
      connectTimeout = 10000
      readTimeout = 10000
      setRequestProperty("Authorization", "Bearer $token")
      setRequestProperty("Accept", "application/json")
    }

    try {
      val body = if (connection.responseCode in 200..299) {
        connection.inputStream.bufferedReader().use { it.readText() }
      } else {
        val error = connection.errorStream?.bufferedReader()?.use { it.readText() }
        throw IllegalStateException(error ?: "Spotify search failed with HTTP ${connection.responseCode}.")
      }

      val items = JSONObject(body)
        .getJSONObject("tracks")
        .getJSONArray("items")

      return@withContext (0 until items.length()).map { index ->
        val item = items.getJSONObject(index)
        val album = item.optJSONObject("album")
        val images = album?.optJSONArray("images")
        val artists = item.getJSONArray("artists")
        val firstArtist = artists.optJSONObject(0)
        mapOf(
          "id" to item.getString("id"),
          "spotifyUri" to item.getString("uri"),
          "provider" to "spotify",
          "title" to item.getString("name"),
          "artist" to (firstArtist?.optString("name") ?: ""),
          "album" to (album?.optString("name") ?: ""),
          "artworkUrl" to (images?.optJSONObject(0)?.optString("url") ?: ""),
          "durationMs" to item.optLong("duration_ms")
        )
      }
    } finally {
      connection.disconnect()
    }
  }

  private suspend fun getUserSpotifyPlaylists(limit: Int): List<Map<String, Any?>> = withContext(Dispatchers.IO) {
    val token = accessToken ?: throw IllegalStateException("Spotify authorization is required before loading playlists.")
    val url = URL("https://api.spotify.com/v1/me/playlists?limit=$limit&offset=0")
    val connection = (url.openConnection() as HttpURLConnection).apply {
      requestMethod = "GET"
      connectTimeout = 10000
      readTimeout = 10000
      setRequestProperty("Authorization", "Bearer $token")
      setRequestProperty("Accept", "application/json")
    }

    try {
      val body = if (connection.responseCode in 200..299) {
        connection.inputStream.bufferedReader().use { it.readText() }
      } else {
        val error = connection.errorStream?.bufferedReader()?.use { it.readText() }
        throw IllegalStateException(error ?: "Spotify playlists request failed with HTTP ${connection.responseCode}.")
      }

      val items = JSONObject(body).getJSONArray("items")
      return@withContext (0 until items.length()).map { index ->
        val item = items.getJSONObject(index)
        val images = item.optJSONArray("images")
        val owner = item.optJSONObject("owner")
        val tracks = item.optJSONObject("tracks")
        mapOf(
          "id" to item.getString("id"),
          "type" to "playlist",
          "spotifyUri" to item.getString("uri"),
          "uri" to item.getString("uri"),
          "provider" to "spotify",
          "title" to item.optString("name", "Spotify Playlist"),
          "artist" to (owner?.optString("display_name") ?: "Spotify"),
          "ownerName" to (owner?.optString("display_name") ?: ""),
          "album" to "",
          "artworkUrl" to (images?.optJSONObject(0)?.optString("url") ?: ""),
          "durationMs" to 0,
          "trackCount" to (tracks?.optInt("total") ?: 0)
        )
      }
    } finally {
      connection.disconnect()
    }
  }

  private suspend fun startSpotifyPlayback(uri: String, queue: List<Map<String, Any?>>) = withContext(Dispatchers.IO) {
    val deviceId = activateAvailableSpotifyDevice()
      ?: throw IllegalStateException("NO_ACTIVE_DEVICE: No active Spotify device found.")
    val encodedDeviceId = URLEncoder.encode(deviceId, StandardCharsets.UTF_8.name())
    val url = URL("https://api.spotify.com/v1/me/player/play?device_id=$encodedDeviceId")
    val body = JSONObject()
    if (uri.startsWith("spotify:playlist:") || uri.startsWith("spotify:album:") || uri.startsWith("spotify:artist:")) {
      body.put("context_uri", uri)
      body.put("position_ms", 0)
    } else {
      val uris = JSONArray()
      queue.mapNotNull { spotifyUriFrom(it) }
        .filter { it.startsWith("spotify:track:") }
        .ifEmpty { listOf(uri) }
        .forEach { uris.put(it) }
      body.put("uris", uris)
      body.put("position_ms", 0)
    }
    spotifyRequest(url, "PUT", body)
  }

  private suspend fun activateAvailableSpotifyDevice(): String? = withContext(Dispatchers.IO) {
    val token = accessToken ?: throw IllegalStateException("Spotify authorization is required before activating a device.")
    val devicesUrl = URL("https://api.spotify.com/v1/me/player/devices")
    val connection = (devicesUrl.openConnection() as HttpURLConnection).apply {
      requestMethod = "GET"
      connectTimeout = 10000
      readTimeout = 10000
      setRequestProperty("Authorization", "Bearer $token")
      setRequestProperty("Accept", "application/json")
    }

    try {
      val body = if (connection.responseCode in 200..299) {
        connection.inputStream.bufferedReader().use { it.readText() }
      } else {
        val error = connection.errorStream?.bufferedReader()?.use { it.readText() }
        throw IllegalStateException(error ?: "Spotify devices request failed with HTTP ${connection.responseCode}.")
      }
      val devices = JSONObject(body).getJSONArray("devices")
      val candidates = (0 until devices.length())
        .map { devices.getJSONObject(it) }
        .filter { !it.optBoolean("is_restricted", false) && it.optString("id").isNotBlank() }
      val selected = candidates.firstOrNull { it.optBoolean("is_active", false) }
        ?: candidates.firstOrNull { it.optString("type").contains("smartphone", ignoreCase = true) }
        ?: candidates.firstOrNull()
        ?: return@withContext null
      val deviceId = selected.optString("id")
      val transferBody = JSONObject()
        .put("device_ids", JSONArray().put(deviceId))
        .put("play", false)
      spotifyRequest(URL("https://api.spotify.com/v1/me/player"), "PUT", transferBody)
      return@withContext deviceId
    } finally {
      connection.disconnect()
    }
  }

  private fun spotifyRequest(url: URL, method: String, body: JSONObject? = null) {
    val token = accessToken ?: throw IllegalStateException("Spotify authorization is required.")
    val connection = (url.openConnection() as HttpURLConnection).apply {
      requestMethod = method
      connectTimeout = 10000
      readTimeout = 10000
      doInput = true
      setRequestProperty("Authorization", "Bearer $token")
      setRequestProperty("Accept", "application/json")
      setRequestProperty("Content-Type", "application/json")
      if (body != null) {
        doOutput = true
      }
    }

    try {
      if (body != null) {
        connection.outputStream.use { output ->
          output.write(body.toString().toByteArray(StandardCharsets.UTF_8))
        }
      }
      if (connection.responseCode !in 200..299) {
        val error = connection.errorStream?.bufferedReader()?.use { it.readText() }
        throw IllegalStateException(error ?: "Spotify request failed with HTTP ${connection.responseCode}.")
      }
    } finally {
      connection.disconnect()
    }
  }

  private fun updateFromPlayerState(state: PlayerState) {
    isPlaying = !state.isPaused
    positionMs = state.playbackPosition
    playbackStatus = if (state.isPaused) "paused" else "playing"

    state.track?.let { track ->
      val liveTrack = mapOf(
        "id" to track.uri,
        "spotifyUri" to track.uri,
        "provider" to "spotify",
        "title" to track.name,
        "artist" to track.artist.name,
        "album" to track.album.name,
        "durationMs" to track.duration
      )
      val queuedIndex = playbackQueue.indexOfFirst { it["spotifyUri"] == track.uri || it["id"] == track.uri }
      if (queuedIndex >= 0) {
        currentQueueIndex = queuedIndex
        currentTrack = playbackQueue[queuedIndex] + liveTrack
      } else {
        currentTrack = liveTrack
      }
    }
  }

  private fun advanceQueueIndex(offset: Int) {
    if (playbackQueue.isEmpty()) {
      return
    }

    currentQueueIndex = (currentQueueIndex + offset).coerceIn(0, playbackQueue.lastIndex)
    currentTrack = playbackQueue[currentQueueIndex]
  }

  private fun spotifyUriFrom(track: Map<String, Any?>): String? {
    listOf("spotifyUri", "uri", "playlistId", "id").forEach { key ->
      val value = track[key] as? String
      if (value != null && value.startsWith("spotify:")) {
        return value
      }
    }
    return null
  }

  private fun mergeTrackPayload(track: Map<String, Any?>, uri: String): Map<String, Any?> {
    return track + mapOf(
      "id" to (track["id"] ?: uri),
      "spotifyUri" to uri,
      "provider" to "spotify"
    )
  }

  private fun launchSpotifyUri(uri: String) {
    val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(uri)).apply {
      setPackage("com.spotify.music")
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }

    if (intent.resolveActivity(context.packageManager) != null) {
      context.startActivity(intent)
      return
    }

    val fallbackIntent = Intent(Intent.ACTION_VIEW, Uri.parse(uri)).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    context.startActivity(fallbackIntent)
  }

  private fun currentState(): Map<String, Any?> {
    val remote = spotifyAppRemote
    val connected = remote?.isConnected == true
    return mapOf(
      "provider" to "spotify",
      "available" to true,
      "isConnected" to connected,
      "isPlaying" to isPlaying,
      "playbackStatus" to playbackStatus,
      "positionMs" to positionMs,
      "currentTrack" to currentTrack,
      "queue" to playbackQueue,
      "authorizationStatus" to if (accessToken != null) "authorized" else "notDetermined"
    )
  }

  private fun emitState() {
    sendEvent("onPlaybackStateChanged", currentState())
  }

  companion object {
    private const val SPOTIFY_AUTH_REQUEST_CODE = 4926
  }
}
