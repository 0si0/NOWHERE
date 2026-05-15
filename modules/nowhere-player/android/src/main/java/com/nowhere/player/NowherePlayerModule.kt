package com.nowhere.player

import android.Manifest
import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
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
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.coroutines.suspendCoroutine
import kotlin.math.roundToInt

class NowherePlayerModule : Module() {
  private var clientId: String = ""
  private var redirectUri: String = "com.nowhere.nowhere://spotify-auth"
  private var returnToAppUri: String = "com.nowhere.nowhere://spotify-auth"
  private var accessToken: String? = null
  private var tokenExpiresAtMs: Long = 0L
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
  private var requestedScopes: Array<String> = arrayOf("user-read-currently-playing")
  private var screenStateReceiver: BroadcastReceiver? = null

  override fun definition() = ModuleDefinition {
    Name("NowherePlayer")

    Events("onPlaybackStateChanged", "onScreenStateChanged", "onPlaybackNotificationPressed")

    OnStartObserving("onScreenStateChanged") {
      registerScreenStateReceiver()
    }

    OnStopObserving("onScreenStateChanged") {
      unregisterScreenStateReceiver()
    }

    OnDestroy {
      unregisterScreenStateReceiver()
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
          tokenExpiresAtMs = System.currentTimeMillis() + response.expiresIn.toLong() * 1000L
          persistSpotifySession()
          if (shouldOpenSpotifyAfterAuth) {
            shouldOpenSpotifyAfterAuth = false
            playbackStatus = "preparingAutoPlay"
            launchSpotifyUri(pendingAutoPlayPrimerUri ?: "spotify:", requireSpotifyApp = true)
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

      val forcePrompt = options["forcePrompt"] == true || options["showDialog"] == true

      if (!forcePrompt && isAccessTokenValid()) {
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
        .setScopes(requestedScopes)
        .setShowDialog(forcePrompt)
        .build()
      AuthorizationClient.openLoginActivity(activity, SPOTIFY_AUTH_REQUEST_CODE, request)
    }

    AsyncFunction("connectAsync") { options: Map<String, Any?>, promise: Promise ->
      applyOptions(options)
      connectToSpotify(promise)
    }

    AsyncFunction("openSpotifyUrlAsync") { uri: String, options: Map<String, Any?>, promise: Promise ->
      applyOptions(options)
      try {
        launchSpotifyUri(uri)
        promise.resolve(currentState())
      } catch (error: Throwable) {
        promise.reject("ERR_SPOTIFY_OPEN", error.localizedMessage, error)
      }
    }

    AsyncFunction("clearAuthorizationAsync") { promise: Promise ->
      accessToken = null
      tokenExpiresAtMs = 0L
      spotifyTokenPrefs()?.edit()?.clear()?.apply()
      currentTrack = null
      playbackQueue = emptyList()
      currentQueueIndex = 0
      isPlaying = false
      positionMs = 0L
      playbackStatus = "stopped"
      playerStateSubscription?.cancel()
      playerStateSubscription = null
      spotifyAppRemote?.let { SpotifyAppRemote.disconnect(it) }
      spotifyAppRemote = null
      emitState()
      promise.resolve(currentState())
    }

    AsyncFunction("requestPlaybackNotificationPermissionAsync") { promise: Promise ->
      val context = appContext.reactContext ?: run {
        promise.resolve(mapOf("available" to false, "granted" to false, "status" to "unavailable"))
        return@AsyncFunction
      }
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
        promise.resolve(mapOf("available" to true, "granted" to true, "status" to "authorized"))
        return@AsyncFunction
      }
      if (context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
        promise.resolve(mapOf("available" to true, "granted" to true, "status" to "authorized"))
        return@AsyncFunction
      }
      appContext.currentActivity?.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), PLAYBACK_NOTIFICATION_PERMISSION_REQUEST_CODE)
      promise.resolve(mapOf("available" to true, "granted" to false, "requested" to true, "status" to "requested"))
    }

    AsyncFunction("schedulePlaybackNotificationAsync") { options: Map<String, Any?>, promise: Promise ->
      val context = appContext.reactContext ?: run {
        promise.reject("ERR_CONTEXT_UNAVAILABLE", "React context is unavailable.", null)
        return@AsyncFunction
      }
      NowherePlaybackNotificationReceiver.schedule(context, options)
      promise.resolve(mapOf("scheduled" to true, "identifier" to (options["identifier"] as? String ?: "")))
    }

    AsyncFunction("cancelPlaybackNotificationsAsync") { prefix: String, promise: Promise ->
      val context = appContext.reactContext ?: run {
        promise.resolve(mapOf("cancelled" to 0))
        return@AsyncFunction
      }
      val cancelled = NowherePlaybackNotificationReceiver.cancel(context, prefix)
      promise.resolve(mapOf("cancelled" to cancelled))
    }

    AsyncFunction("getPendingPlaybackNotificationAsync") { promise: Promise ->
      promise.resolve(null)
    }

    AsyncFunction("searchCatalogAsync") Coroutine { query: String, limit: Int ->
      return@Coroutine searchSpotifyTracks(query, limit.coerceIn(1, 25))
    }

    AsyncFunction("getUserPlaylistsAsync") Coroutine { limit: Int ->
      return@Coroutine getUserSpotifyPlaylists(limit.coerceIn(1, 50))
    }

    AsyncFunction("getUserTopTracksAsync") Coroutine { limit: Int ->
      return@Coroutine getUserSpotifyTopTracks(limit.coerceIn(1, 50))
    }

    AsyncFunction("getRecentlyPlayedTracksAsync") Coroutine { limit: Int ->
      return@Coroutine getSpotifyRecentlyPlayedTracks(limit.coerceIn(1, 50))
    }

    AsyncFunction("getPlaylistTracksAsync") Coroutine { playlistId: String, limit: Int ->
      return@Coroutine getSpotifyPlaylistTracks(playlistId, limit.coerceIn(1, 50))
    }

    AsyncFunction("extractAlbumColorAsync") Coroutine { albumArtUrl: String ->
      return@Coroutine withContext(Dispatchers.IO) {
        extractDominantAlbumColor(albumArtUrl)
      }
    }

    AsyncFunction("prepareAutoPlayAsync") { options: Map<String, Any?>, promise: Promise ->
      applyOptions(options)
      @Suppress("UNCHECKED_CAST")
      val primerUri = spotifyUriFrom(options["autoPlayPrimer"] as? Map<String, Any?> ?: emptyMap())
      val activity = appContext.currentActivity ?: run {
        promise.reject("ERR_ACTIVITY_UNAVAILABLE", "Current Android activity is unavailable.", null)
        return@AsyncFunction
      }

      playbackStatus = "preparingAutoPlay"
      primerUri?.let { uri ->
        currentTrack = mergeTrackPayload(options["autoPlayPrimer"] as? Map<String, Any?> ?: emptyMap(), uri)
        playbackQueue = listOfNotNull(currentTrack)
        currentQueueIndex = 0
        isPlaying = true
      }
      if (primerUri == null) {
        launchSpotifyUri("spotify:", requireSpotifyApp = true)
        emitState()
        promise.resolve(currentState())
      } else {
        ensureConnected(
          onReady = {
            val remote = spotifyAppRemote ?: run {
              promise.reject("ERR_SPOTIFY_NOT_CONNECTED", "Spotify App Remote is not connected.", null)
              return@ensureConnected
            }
            remote.playerApi.play(primerUri)
              .setResultCallback {
                playbackStatus = "playing"
                isPlaying = true
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

      playWithWebApiThenAppRemoteFallback(uri, playbackQueue)
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
      playbackStatus = "loading"
      emitState()

      ensureConnected(
        onReady = {
          val remote = spotifyAppRemote ?: run {
            promise.reject("ERR_SPOTIFY_NOT_CONNECTED", "Spotify App Remote is not connected.", null)
            return@ensureConnected
          }
          remote.playerApi.play(uri)
            .setResultCallback {
              isPlaying = true
              playbackStatus = "playing"
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

    AsyncFunction("getStateAsync") Coroutine { ->
      refreshCurrentPlaybackState()
      return@Coroutine currentState()
    }
  }

  private fun applyOptions(options: Map<String, Any?>) {
    loadPersistedSpotifySession()
    (options["spotifyClientId"] as? String)?.takeIf { it.isNotBlank() }?.let {
      clientId = it
    }
    (options["spotifyRedirectUri"] as? String)?.takeIf { it.isNotBlank() }?.let {
      redirectUri = it
    }
    (options["returnToAppUri"] as? String)?.takeIf { it.isNotBlank() }?.let {
      returnToAppUri = it
    }
    (options["returnUri"] as? String)?.takeIf { it.isNotBlank() }?.let {
      returnToAppUri = it
    }
    val scopesOption = options["scopes"]
    requestedScopes = when (scopesOption) {
      is List<*> -> scopesOption.mapNotNull { it as? String }.map { it.trim() }.filter { it.isNotBlank() }.toTypedArray()
      is Array<*> -> scopesOption.mapNotNull { it as? String }.map { it.trim() }.filter { it.isNotBlank() }.toTypedArray()
      is String -> scopesOption.split(" ").map { it.trim() }.filter { it.isNotBlank() }.toTypedArray()
      else -> requestedScopes
    }.ifEmpty { arrayOf("user-read-currently-playing") }
  }

  private fun spotifyTokenPrefs() =
    appContext.reactContext?.getSharedPreferences("nowhere_spotify_auth", Context.MODE_PRIVATE)

  private fun loadPersistedSpotifySession() {
    val prefs = spotifyTokenPrefs() ?: return
    if (accessToken == null) {
      accessToken = prefs.getString("accessToken", null)
    }
    if (tokenExpiresAtMs <= 0L) {
      tokenExpiresAtMs = prefs.getLong("expiresAtMs", 0L)
    }
    if (!isAccessTokenValid()) {
      accessToken = null
      tokenExpiresAtMs = 0L
    }
  }

  private fun persistSpotifySession() {
    val prefs = spotifyTokenPrefs() ?: return
    prefs.edit()
      .putString("accessToken", accessToken)
      .putLong("expiresAtMs", tokenExpiresAtMs)
      .apply()
  }

  private fun isAccessTokenValid(): Boolean {
    val token = accessToken
    return !token.isNullOrBlank() && tokenExpiresAtMs - System.currentTimeMillis() > 60_000L
  }

  private fun requireValidAccessToken(action: String): String {
    loadPersistedSpotifySession()
    if (!isAccessTokenValid()) {
      throw IllegalStateException("Spotify authorization is required before $action.")
    }
    return accessToken ?: throw IllegalStateException("Spotify authorization is required before $action.")
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

  private suspend fun playWithAppRemote(uri: String) = suspendCoroutine<Unit> { continuation ->
    ensureConnected(
      onReady = {
        val remote = spotifyAppRemote ?: run {
          continuation.resumeWithException(IllegalStateException("Spotify App Remote is not connected."))
          return@ensureConnected
        }
        remote.playerApi.play(uri)
          .setResultCallback {
            continuation.resume(Unit)
          }
          .setErrorCallback { error ->
            continuation.resumeWithException(error)
          }
      },
      onError = { error ->
        continuation.resumeWithException(error)
      }
    )
  }

  private suspend fun playWithWebApiThenAppRemoteFallback(uri: String, queue: List<Map<String, Any?>>) {
    try {
      startSpotifyPlayback(uri, queue)
    } catch (error: Throwable) {
      if (!isNoActiveDeviceError(error) || appContext.currentActivity == null) {
        throw error
      }
      playWithAppRemote(uri)
    }
  }

  private fun isNoActiveDeviceError(error: Throwable): Boolean {
    val message = error.localizedMessage ?: error.message ?: return false
    return message.contains("NO_ACTIVE_DEVICE", ignoreCase = true) ||
      message.contains("No active Spotify device", ignoreCase = true) ||
      message.contains("No active device", ignoreCase = true)
  }

  private fun subscribeToPlayerState(remote: SpotifyAppRemote) {
    playerStateSubscription?.cancel()
    val subscription = remote.playerApi.subscribeToPlayerState()
    subscription
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
    playerStateSubscription = subscription
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
    val token = requireValidAccessToken("search.")
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
    val token = requireValidAccessToken("loading playlists.")
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

  private suspend fun getUserSpotifyTopTracks(limit: Int): List<Map<String, Any?>> = withContext(Dispatchers.IO) {
    val token = requireValidAccessToken("loading top tracks.")
    val url = URL("https://api.spotify.com/v1/me/top/tracks?limit=$limit&time_range=medium_term")
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
        throw IllegalStateException(error ?: "Spotify top tracks request failed with HTTP ${connection.responseCode}.")
      }

      val items = JSONObject(body).getJSONArray("items")
      return@withContext (0 until items.length()).map { index ->
        val item = items.getJSONObject(index)
        val album = item.optJSONObject("album")
        val images = album?.optJSONArray("images")
        val artists = item.getJSONArray("artists")
        val firstArtist = artists.optJSONObject(0)
        mapOf(
          "id" to item.getString("id"),
          "spotifyUri" to item.getString("uri"),
          "uri" to item.getString("uri"),
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

  private suspend fun getSpotifyRecentlyPlayedTracks(limit: Int): List<Map<String, Any?>> = withContext(Dispatchers.IO) {
    val token = requireValidAccessToken("loading recently played tracks.")
    val url = URL("https://api.spotify.com/v1/me/player/recently-played?limit=$limit")
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
        throw IllegalStateException(error ?: "Spotify recently played request failed with HTTP ${connection.responseCode}.")
      }

      val items = JSONObject(body).getJSONArray("items")
      return@withContext (0 until items.length()).mapNotNull { index ->
        val item = items.getJSONObject(index)
        val track = item.optJSONObject("track") ?: return@mapNotNull null
        val album = track.optJSONObject("album")
        val images = album?.optJSONArray("images")
        val artists = track.optJSONArray("artists")
        val firstArtist = artists?.optJSONObject(0)
        mapOf(
          "id" to track.optString("id", track.optString("uri")),
          "spotifyUri" to track.optString("uri"),
          "uri" to track.optString("uri"),
          "provider" to "spotify",
          "title" to track.optString("name", "Unknown Track"),
          "artist" to (firstArtist?.optString("name") ?: ""),
          "album" to (album?.optString("name") ?: ""),
          "artworkUrl" to (images?.optJSONObject(0)?.optString("url") ?: ""),
          "durationMs" to track.optLong("duration_ms"),
          "playedAt" to item.optString("played_at", "")
        )
      }
    } finally {
      connection.disconnect()
    }
  }

  private suspend fun getSpotifyPlaylistTracks(playlistId: String, limit: Int): List<Map<String, Any?>> = withContext(Dispatchers.IO) {
    val token = requireValidAccessToken("loading playlist tracks.")
    val trimmedPlaylistId = playlistId.trim()
    if (trimmedPlaylistId.isBlank()) {
      return@withContext emptyList()
    }

    val url = URL("https://api.spotify.com/v1/playlists/$trimmedPlaylistId/tracks?limit=$limit&offset=0&market=KR")
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
        throw IllegalStateException(error ?: "Spotify playlist tracks request failed with HTTP ${connection.responseCode}.")
      }

      val items = JSONObject(body).getJSONArray("items")
      return@withContext (0 until items.length()).mapNotNull { index ->
        val track = items.getJSONObject(index).optJSONObject("track") ?: return@mapNotNull null
        if (track.optString("type", "track") != "track") {
          return@mapNotNull null
        }
        val album = track.optJSONObject("album")
        val images = album?.optJSONArray("images")
        val artists = track.optJSONArray("artists")
        val firstArtist = artists?.optJSONObject(0)
        mapOf(
          "id" to track.optString("id", track.optString("uri")),
          "spotifyUri" to track.optString("uri"),
          "uri" to track.optString("uri"),
          "provider" to "spotify",
          "title" to track.optString("name", "Unknown Track"),
          "artist" to (firstArtist?.optString("name") ?: ""),
          "album" to (album?.optString("name") ?: ""),
          "artworkUrl" to (images?.optJSONObject(0)?.optString("url") ?: ""),
          "durationMs" to track.optLong("duration_ms")
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
    val token = requireValidAccessToken("activating a device.")
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
    val token = requireValidAccessToken("playback.")
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

  private suspend fun refreshCurrentPlaybackState() = withContext(Dispatchers.IO) {
    val token = accessToken ?: run {
      isPlaying = false
      playbackStatus = "notDetermined"
      return@withContext
    }
    val url = URL("https://api.spotify.com/v1/me/player/currently-playing")
    val connection = (url.openConnection() as HttpURLConnection).apply {
      requestMethod = "GET"
      connectTimeout = 10000
      readTimeout = 10000
      setRequestProperty("Authorization", "Bearer $token")
      setRequestProperty("Accept", "application/json")
    }

    try {
      val status = connection.responseCode
      if (status == 204) {
        isPlaying = false
        currentTrack = null
        positionMs = 0L
        playbackQueue = emptyList()
        playbackStatus = "noPlayback"
        return@withContext
      }
      if (status !in 200..299) {
        isPlaying = false
        currentTrack = null
        playbackQueue = emptyList()
        playbackStatus = if (status == 401 || status == 403) {
          "playbackAccessDenied"
        } else {
          "playbackStateUnavailable"
        }
        return@withContext
      }

      val body = connection.inputStream.bufferedReader().use { it.readText() }
      if (body.isBlank()) {
        return@withContext
      }

      val json = JSONObject(body)
      isPlaying = json.optBoolean("is_playing", isPlaying)
      positionMs = json.optLong("progress_ms", positionMs)
      playbackStatus = if (isPlaying) "playing" else "paused"

      val item = json.optJSONObject("item") ?: return@withContext
      val album = item.optJSONObject("album")
      val images = album?.optJSONArray("images")
      val artists = item.optJSONArray("artists")
      val firstArtist = artists?.optJSONObject(0)
      val uri = item.optString("uri", "")
      val liveTrack = mapOf(
        "id" to item.optString("id", uri),
        "spotifyUri" to uri,
        "provider" to "spotify",
        "title" to item.optString("name", ""),
        "artist" to (firstArtist?.optString("name") ?: ""),
        "album" to (album?.optString("name") ?: ""),
        "artworkUrl" to (images?.optJSONObject(0)?.optString("url") ?: ""),
        "durationMs" to item.optLong("duration_ms")
      )
      val queuedIndex = playbackQueue.indexOfFirst { it["spotifyUri"] == uri || it["id"] == uri }
      if (queuedIndex >= 0) {
        currentQueueIndex = queuedIndex
        currentTrack = playbackQueue[queuedIndex] + liveTrack
      } else {
        currentTrack = liveTrack
      }
    } catch (error: Throwable) {
      isPlaying = false
      currentTrack = null
      playbackQueue = emptyList()
      playbackStatus = "playbackStateUnavailable"
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

  private fun launchSpotifyUri(uri: String, requireSpotifyApp: Boolean = false) {
    val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(uri)).apply {
      setPackage("com.spotify.music")
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }

    if (intent.resolveActivity(context.packageManager) != null) {
      context.startActivity(intent)
      scheduleReturnToNowhere()
      return
    }

    if (requireSpotifyApp) {
      throw IllegalStateException("Spotify app is not available.")
    }

    val fallbackIntent = Intent(Intent.ACTION_VIEW, Uri.parse(uri)).apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    context.startActivity(fallbackIntent)
    scheduleReturnToNowhere()
  }

  private fun scheduleReturnToNowhere() {
    val context = appContext.reactContext ?: return
    val uri = returnToAppUri.takeIf { it.isNotBlank() } ?: return
    val handler = Handler(Looper.getMainLooper())
    val returnToNowhere = {
      try {
        val returnIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
          data = Uri.parse(uri)
          action = Intent.ACTION_VIEW
          addCategory(Intent.CATEGORY_BROWSABLE)
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
          addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        } ?: Intent(Intent.ACTION_VIEW, Uri.parse(uri)).apply {
          setPackage(context.packageName)
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
          addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }
        context.startActivity(returnIntent)
      } catch (error: Throwable) {
      }
    }
    handler.postDelayed(returnToNowhere, 1800L)
    handler.postDelayed(returnToNowhere, 4200L)
    handler.postDelayed(returnToNowhere, 7200L)
  }

  private fun registerScreenStateReceiver() {
    val context = appContext.reactContext ?: return
    if (screenStateReceiver != null) {
      return
    }

    val receiver = object : BroadcastReceiver() {
      override fun onReceive(context: Context?, intent: Intent?) {
        when (intent?.action) {
          Intent.ACTION_SCREEN_OFF -> sendEvent(
            "onScreenStateChanged",
            mapOf("state" to "off", "isScreenOn" to false)
          )
          Intent.ACTION_SCREEN_ON -> sendEvent(
            "onScreenStateChanged",
            mapOf("state" to "on", "isScreenOn" to true)
          )
          Intent.ACTION_USER_PRESENT -> sendEvent(
            "onScreenStateChanged",
            mapOf("state" to "unlocked", "isScreenOn" to true)
          )
        }
      }
    }
    val filter = IntentFilter().apply {
      addAction(Intent.ACTION_SCREEN_OFF)
      addAction(Intent.ACTION_SCREEN_ON)
      addAction(Intent.ACTION_USER_PRESENT)
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      context.registerReceiver(receiver, filter)
    }
    screenStateReceiver = receiver
  }

  private fun unregisterScreenStateReceiver() {
    val context = appContext.reactContext ?: return
    val receiver = screenStateReceiver ?: return
    try {
      context.unregisterReceiver(receiver)
    } catch (error: Throwable) {
    } finally {
      screenStateReceiver = null
    }
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
      "authorizationStatus" to if (isAccessTokenValid()) "authorized" else "notDetermined",
      "isAuthorized" to isAccessTokenValid()
    )
  }

  private fun emitState() {
    sendEvent("onPlaybackStateChanged", currentState())
  }

  private fun extractDominantAlbumColor(albumArtUrl: String): String {
    if (albumArtUrl.isBlank()) {
      throw IllegalArgumentException("Album artwork URL is invalid.")
    }

    val connection = (URL(albumArtUrl).openConnection() as HttpURLConnection).apply {
      connectTimeout = 5000
      readTimeout = 7000
      requestMethod = "GET"
    }

    connection.inputStream.use { stream ->
      val bitmap = BitmapFactory.decodeStream(stream)
        ?: throw IllegalArgumentException("Album artwork could not be decoded.")
      val scaled = Bitmap.createScaledBitmap(bitmap, 32, 32, true)
      if (scaled != bitmap) {
        bitmap.recycle()
      }

      val buckets = mutableMapOf<String, IntArray>()
      var redTotal = 0
      var greenTotal = 0
      var blueTotal = 0
      var averageCount = 0

      for (y in 0 until scaled.height) {
        for (x in 0 until scaled.width) {
          val pixel = scaled.getPixel(x, y)
          val alpha = android.graphics.Color.alpha(pixel)
          if (alpha < 180) continue
          val red = android.graphics.Color.red(pixel)
          val green = android.graphics.Color.green(pixel)
          val blue = android.graphics.Color.blue(pixel)

          redTotal += red
          greenTotal += green
          blueTotal += blue
          averageCount += 1

          val luma = (0.2126 * red) + (0.7152 * green) + (0.0722 * blue)
          if (luma < 24 || luma > 238) continue

          val bucketRed = ((red / 24.0).roundToInt() * 24).coerceAtMost(255)
          val bucketGreen = ((green / 24.0).roundToInt() * 24).coerceAtMost(255)
          val bucketBlue = ((blue / 24.0).roundToInt() * 24).coerceAtMost(255)
          val key = "$bucketRed,$bucketGreen,$bucketBlue"
          val bucket = buckets[key] ?: intArrayOf(0, bucketRed, bucketGreen, bucketBlue)
          bucket[0] += 1
          buckets[key] = bucket
        }
      }

      scaled.recycle()

      buckets.values.maxByOrNull { it[0] }?.let { dominant ->
        return String.format("#%02X%02X%02X", dominant[1], dominant[2], dominant[3])
      }

      if (averageCount <= 0) {
        throw IllegalArgumentException("Album artwork did not contain usable pixels.")
      }
      return String.format("#%02X%02X%02X", redTotal / averageCount, greenTotal / averageCount, blueTotal / averageCount)
    }
  }

  companion object {
    private const val SPOTIFY_AUTH_REQUEST_CODE = 4926
    private const val PLAYBACK_NOTIFICATION_PERMISSION_REQUEST_CODE = 4927
  }
}
