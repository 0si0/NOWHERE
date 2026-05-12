import AuthenticationServices
import CryptoKit
import ExpoModulesCore
import Foundation
import UIKit

public final class NowherePlayerModule: Module, @unchecked Sendable {
  private let tokenStorageAccessTokenKey = "nowhere.spotify.accessToken"
  private let tokenStorageRefreshTokenKey = "nowhere.spotify.refreshToken"
  private let tokenStorageExpiresAtKey = "nowhere.spotify.expiresAt"
  private var clientId = ""
  private var redirectUri = "com.nowhere.nowhere://spotify-auth"
  private var accessToken: String?
  private var refreshToken: String?
  private var tokenExpiresAt: Date?
  private var currentTrack: [String: Any?]?
  private var playbackQueue: [[String: Any?]] = []
  private var currentQueueIndex = 0
  private var isPlaying = false
  private var positionMs = 0
  private var playbackStatus = "idle"
  private var lastError: String?
  private var requestedScopes = ["user-read-currently-playing"]
  private var authSession: ASWebAuthenticationSession?
  private let authPresentationContextProvider = AuthPresentationContextProvider()
  private let appRemoteCoordinator = SpotifyAppRemoteCoordinator.shared

  public func definition() -> ModuleDefinition {
    Name("NowherePlayer")

    Events("onPlaybackStateChanged")

    OnDestroy {
      self.authSession?.cancel()
      self.authSession = nil
      self.appRemoteCoordinator.onPlayerState = nil
      self.appRemoteCoordinator.onStatus = nil
      self.appRemoteCoordinator.disconnect()
    }

    AsyncFunction("configureAsync") { (options: [String: Any]) -> [String: Any?] in
      self.applyOptions(options)
      return self.currentState()
    }

    AsyncFunction("requestAuthorizationAsync") { (options: [String: Any]) async throws -> [String: Any?] in
      self.applyOptions(options)
      try await self.ensureAuthorized(forcePrompt: self.firstBool(options, keys: ["forcePrompt", "showDialog"]))
      return [
        "provider": "spotify",
        "available": true,
        "status": "authorized",
        "authorized": true
      ]
    }

    AsyncFunction("connectAsync") { (options: [String: Any]) async throws -> [String: Any?] in
      self.applyOptions(options)
      try await self.ensureAuthorized()
      await self.refreshPlayerState()
      return self.currentState()
    }

    AsyncFunction("searchCatalogAsync") { (query: String, limit: Int) async throws -> [[String: Any?]] in
      try await self.ensureAuthorized()
      return try await self.searchSpotifyTracks(query: query, limit: max(1, min(limit, 25)))
    }

    AsyncFunction("getUserPlaylistsAsync") { (limit: Int) async throws -> [[String: Any?]] in
      try await self.ensureAuthorized()
      return try await self.getUserSpotifyPlaylists(limit: max(1, min(limit, 50)))
    }

    AsyncFunction("getUserTopTracksAsync") { (limit: Int) async throws -> [[String: Any?]] in
      try await self.ensureAuthorized()
      return try await self.getUserSpotifyTopTracks(limit: max(1, min(limit, 50)))
    }

    AsyncFunction("getRecentlyPlayedTracksAsync") { (limit: Int) async throws -> [[String: Any?]] in
      try await self.ensureAuthorized()
      return try await self.getSpotifyRecentlyPlayedTracks(limit: max(1, min(limit, 50)))
    }

    AsyncFunction("getPlaylistTracksAsync") { (playlistId: String, limit: Int) async throws -> [[String: Any?]] in
      try await self.ensureAuthorized()
      return try await self.getSpotifyPlaylistTracks(playlistId: playlistId, limit: max(1, min(limit, 50)))
    }

    AsyncFunction("extractAlbumColorAsync") { (albumArtUrl: String) async throws -> String in
      return try await self.extractDominantAlbumColor(urlString: albumArtUrl)
    }

    AsyncFunction("prepareAutoPlayAsync") { (options: [String: Any]) async throws -> [String: Any?] in
      self.applyOptions(options)
      let primerTrack = options["autoPlayPrimer"] as? [String: Any]
      let primerUri = primerTrack.flatMap { self.spotifyUri(from: $0) }
      self.openSpotify(uri: primerUri ?? "spotify:")
      if let primerTrack {
        self.currentTrack = primerTrack.mapValues { Optional($0) }
        self.playbackQueue = [self.currentTrack].compactMap { $0 }
        self.currentQueueIndex = 0
      }
      self.isPlaying = primerUri != nil
      self.playbackStatus = "preparingAutoPlay"
      self.lastError = nil
      self.emitState()
      return self.currentState()
    }

    AsyncFunction("playInBackgroundAsync") { (track: [String: Any], queue: [[String: Any]]) async throws -> [String: Any?] in
      let requestedTracks = queue.isEmpty ? [track] : queue
      let resolvedTracks = requestedTracks.compactMap { requestedTrack -> [String: Any?]? in
        guard self.spotifyUri(from: requestedTrack) != nil else {
          return nil
        }
        return requestedTrack.mapValues { Optional($0) }
      }
      guard let firstTrack = resolvedTracks.first, let uri = self.spotifyUri(from: firstTrack) else {
        throw NowherePlayerException("A Spotify URI is required before background playback can start.")
      }

      self.playbackQueue = resolvedTracks
      self.currentQueueIndex = 0
      self.currentTrack = firstTrack
      self.playbackStatus = "loading"
      self.lastError = nil
      self.emitState()

      self.openSpotify(uri: uri)
      self.isPlaying = true
      self.playbackStatus = "openedSpotify"
      self.lastError = nil
      self.emitState()
      return self.currentState()
    }

    AsyncFunction("playAsync") { (track: [String: Any], queue: [[String: Any]]) async throws -> [String: Any?] in
      let requestedTracks = queue.isEmpty ? [track] : queue
      let resolvedTracks = requestedTracks.compactMap { requestedTrack -> [String: Any?]? in
        guard self.spotifyUri(from: requestedTrack) != nil else {
          return nil
        }
        return requestedTrack.mapValues { Optional($0) }
      }
      guard let firstTrack = resolvedTracks.first, let uri = self.spotifyUri(from: firstTrack) else {
        throw NowherePlayerException("A Spotify URI is required before playback can start.")
      }

      self.playbackQueue = resolvedTracks
      self.currentQueueIndex = 0
      self.currentTrack = firstTrack
      self.playbackStatus = "loading"
      self.lastError = nil
      self.emitState()

      self.openSpotify(uri: uri)
      self.isPlaying = true
      self.playbackStatus = "openedSpotify"
      self.lastError = nil

      self.emitState()
      return self.currentState()
    }

    AsyncFunction("pauseAsync") { () async throws -> [String: Any?] in
      try await self.ensureAuthorized()
      try await self.spotifyRequest(path: "/v1/me/player/pause", method: "PUT")
      self.isPlaying = false
      self.playbackStatus = "paused"
      self.lastError = nil
      await self.refreshPlayerState()
      self.emitState()
      return self.currentState()
    }

    AsyncFunction("resumeAsync") { () async throws -> [String: Any?] in
      try await self.ensureAuthorized()
      try await self.spotifyRequest(path: "/v1/me/player/play", method: "PUT")
      self.isPlaying = true
      self.playbackStatus = "playing"
      self.lastError = nil
      await self.refreshPlayerState()
      self.emitState()
      return self.currentState()
    }

    AsyncFunction("stopAsync") { () async throws -> [String: Any?] in
      try await self.ensureAuthorized()
      try? await self.spotifyRequest(path: "/v1/me/player/pause", method: "PUT")
      self.currentTrack = nil
      self.playbackQueue = []
      self.currentQueueIndex = 0
      self.isPlaying = false
      self.positionMs = 0
      self.playbackStatus = "stopped"
      self.lastError = nil
      self.emitState()
      return self.currentState()
    }

    AsyncFunction("skipNextAsync") { () async throws -> [String: Any?] in
      try await self.ensureAuthorized()
      try await self.spotifyRequest(path: "/v1/me/player/next", method: "POST")
      self.advanceQueueIndex(1)
      await self.refreshPlayerState()
      self.emitState()
      return self.currentState()
    }

    AsyncFunction("skipPreviousAsync") { () async throws -> [String: Any?] in
      try await self.ensureAuthorized()
      try await self.spotifyRequest(path: "/v1/me/player/previous", method: "POST")
      self.advanceQueueIndex(-1)
      await self.refreshPlayerState()
      self.emitState()
      return self.currentState()
    }

    AsyncFunction("seekToAsync") { (positionMs: Double) async throws -> [String: Any?] in
      try await self.ensureAuthorized()
      let nextPosition = Int(max(0, positionMs))
      try await self.spotifyRequest(path: "/v1/me/player/seek?position_ms=\(nextPosition)", method: "PUT")
      self.positionMs = nextPosition
      await self.refreshPlayerState()
      self.emitState()
      return self.currentState()
    }

    AsyncFunction("getStateAsync") { () async -> [String: Any?] in
      await self.refreshPlayerState()
      return self.currentState()
    }
  }

  private func applyOptions(_ options: [String: Any]) {
    loadPersistedSpotifySession()
    if let nextClientId = firstString(options, keys: ["spotifyClientId", "clientId"]) {
      clientId = nextClientId
    }
    if let nextRedirectUri = firstString(options, keys: ["spotifyRedirectUri", "redirectUri"]) {
      redirectUri = nextRedirectUri
    }
    if let scopes = options["scopes"] as? [String] {
      let normalizedScopes = scopes
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
      if !normalizedScopes.isEmpty {
        requestedScopes = normalizedScopes
      }
    } else if let scope = firstString(options, keys: ["scope"]) {
      let normalizedScopes = scope
        .split(separator: " ")
        .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
      if !normalizedScopes.isEmpty {
        requestedScopes = normalizedScopes
      }
    }
    configureAppRemote()
  }

  private func configureAppRemote() {
    appRemoteCoordinator.configure(clientId: clientId, redirectUri: redirectUri, accessToken: accessToken)
    appRemoteCoordinator.onPlayerState = { [weak self] payload in
      self?.applyAppRemotePlayerState(payload)
    }
    appRemoteCoordinator.onStatus = { [weak self] status, error in
      self?.applyAppRemoteStatus(status, error: error)
    }
  }

  private func ensureAuthorized(forcePrompt: Bool = false) async throws {
    loadPersistedSpotifySession()

    if !forcePrompt, accessToken != nil, let expiresAt = tokenExpiresAt, expiresAt.timeIntervalSinceNow > 60 {
      return
    }

    if !forcePrompt, let refreshToken {
      do {
        try await refreshAccessToken(refreshToken)
        return
      } catch {
        accessToken = nil
        tokenExpiresAt = nil
        persistSpotifySession()
      }
    }

    try await authorizeWithPKCE(forcePrompt: forcePrompt)
  }

  private func hasValidAccessToken() -> Bool {
    guard accessToken != nil, let expiresAt = tokenExpiresAt else {
      return false
    }
    return expiresAt.timeIntervalSinceNow > 60
  }

  private func authorizeWithPKCE(forcePrompt: Bool = false) async throws {
    guard !clientId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      throw NowherePlayerException("Spotify client id is missing.")
    }
    guard let redirect = URL(string: redirectUri), let callbackScheme = redirect.scheme else {
      throw NowherePlayerException("Spotify redirect URI is invalid.")
    }

    let verifier = randomString(length: 64)
    let challenge = codeChallenge(for: verifier)
    let state = randomString(length: 24)
    let scopes = requestedScopes.isEmpty
      ? "user-read-currently-playing"
      : requestedScopes.joined(separator: " ")

    var components = URLComponents(string: "https://accounts.spotify.com/authorize")
    var queryItems = [
      URLQueryItem(name: "client_id", value: clientId),
      URLQueryItem(name: "response_type", value: "code"),
      URLQueryItem(name: "redirect_uri", value: redirectUri),
      URLQueryItem(name: "code_challenge_method", value: "S256"),
      URLQueryItem(name: "code_challenge", value: challenge),
      URLQueryItem(name: "state", value: state),
      URLQueryItem(name: "scope", value: scopes)
    ]
    if forcePrompt {
      queryItems.append(URLQueryItem(name: "show_dialog", value: "true"))
    }
    components?.queryItems = queryItems

    guard let authURL = components?.url else {
      throw NowherePlayerException("Spotify authorization URL could not be built.")
    }

    let callbackURL = try await startAuthSession(url: authURL, callbackScheme: callbackScheme)
    guard let callbackComponents = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false) else {
      throw NowherePlayerException("Spotify authorization callback is invalid.")
    }

    let returnedState = callbackComponents.queryItems?.first { $0.name == "state" }?.value
    guard returnedState == state else {
      throw NowherePlayerException("Spotify authorization state did not match.")
    }

    if let error = callbackComponents.queryItems?.first(where: { $0.name == "error" })?.value {
      throw NowherePlayerException("Spotify authorization failed: \(error).")
    }

    guard let code = callbackComponents.queryItems?.first(where: { $0.name == "code" })?.value else {
      throw NowherePlayerException("Spotify authorization code was not returned.")
    }

    try await exchangeCodeForToken(code: code, verifier: verifier)
  }

  private func startAuthSession(url: URL, callbackScheme: String) async throws -> URL {
    try await withCheckedThrowingContinuation { continuation in
      DispatchQueue.main.async {
        let session = ASWebAuthenticationSession(url: url, callbackURLScheme: callbackScheme) { callbackURL, error in
          self.authSession = nil
          if let callbackURL {
            continuation.resume(returning: callbackURL)
            return
          }
          continuation.resume(throwing: error ?? NowherePlayerException("Spotify authorization was cancelled."))
        }
        session.presentationContextProvider = self.authPresentationContextProvider
        session.prefersEphemeralWebBrowserSession = false
        self.authSession = session
        if !session.start() {
          self.authSession = nil
          continuation.resume(throwing: NowherePlayerException("Spotify authorization session could not start."))
        }
      }
    }
  }

  private func exchangeCodeForToken(code: String, verifier: String) async throws {
    let payload = [
      "grant_type": "authorization_code",
      "code": code,
      "redirect_uri": redirectUri,
      "client_id": clientId,
      "code_verifier": verifier
    ]
    let json = try await spotifyTokenRequest(payload)
    applyTokenResponse(json)
  }

  private func refreshAccessToken(_ refreshToken: String) async throws {
    let payload = [
      "grant_type": "refresh_token",
      "refresh_token": refreshToken,
      "client_id": clientId
    ]
    let json = try await spotifyTokenRequest(payload)
    applyTokenResponse(json)
  }

  private func spotifyTokenRequest(_ payload: [String: String]) async throws -> [String: Any] {
    var request = URLRequest(url: URL(string: "https://accounts.spotify.com/api/token")!)
    request.httpMethod = "POST"
    request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    request.httpBody = formEncoded(payload).data(using: .utf8)

    let (data, response) = try await URLSession.shared.data(for: request)
    guard let httpResponse = response as? HTTPURLResponse, (200..<300).contains(httpResponse.statusCode) else {
      let message = String(data: data, encoding: .utf8) ?? "Spotify token request failed."
      throw NowherePlayerException(message)
    }

    return try parseJSONObject(data)
  }

  private func spotifyRequest(path: String, method: String, body: [String: Any]? = nil) async throws {
    _ = try await spotifyJSONRequest(path: path, method: method, body: body)
  }

  private func spotifyJSONRequest(path: String, method: String, body: [String: Any]? = nil) async throws -> [String: Any]? {
    guard let token = accessToken else {
      throw NowherePlayerException("Spotify authorization is required.")
    }

    var request = URLRequest(url: URL(string: "https://api.spotify.com\(path)")!)
    request.httpMethod = method
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    if let body {
      request.httpBody = try JSONSerialization.data(withJSONObject: body)
    }

    let (data, response) = try await URLSession.shared.data(for: request)
    guard let httpResponse = response as? HTTPURLResponse else {
      throw NowherePlayerException("Spotify response was invalid.")
    }

    guard (200..<300).contains(httpResponse.statusCode) else {
      throw parseSpotifyAPIError(data, statusCode: httpResponse.statusCode)
    }

    if httpResponse.statusCode == 204 || data.isEmpty {
      return nil
    }

    return try parseJSONObject(data)
  }

  private func activateAvailableSpotifyDevice() async throws -> String? {
    guard let json = try await spotifyJSONRequest(path: "/v1/me/player/devices", method: "GET") else {
      return nil
    }

    let devices = json["devices"] as? [[String: Any]] ?? []
    let unrestrictedDevices = devices.filter { ($0["is_restricted"] as? Bool) != true }
    let preferredDevice = unrestrictedDevices.first(where: { ($0["is_active"] as? Bool) == true })
      ?? unrestrictedDevices.first(where: { firstString($0, keys: ["type"])?.localizedCaseInsensitiveContains("smartphone") == true })
      ?? unrestrictedDevices.first

    guard let device = preferredDevice,
          let deviceId = firstString(device, keys: ["id"]) else {
      return nil
    }

    try await spotifyRequest(
      path: "/v1/me/player",
      method: "PUT",
      body: [
        "device_ids": [deviceId],
        "play": false
      ]
    )
    return deviceId
  }

  private func startSpotifyPlayback(uri: String, queue: [[String: Any?]]) async throws {
    guard let deviceId = try await activateAvailableSpotifyDevice() else {
      throw SpotifyAPIError(statusCode: 404, message: "No active Spotify device found.", reason: "NO_ACTIVE_DEVICE")
    }

    let encodedDeviceId = deviceId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? deviceId
    let path = "/v1/me/player/play?device_id=\(encodedDeviceId)"
    if uri.starts(with: "spotify:playlist:") || uri.starts(with: "spotify:album:") || uri.starts(with: "spotify:artist:") {
      try await spotifyRequest(
        path: path,
        method: "PUT",
        body: [
          "context_uri": uri,
          "position_ms": 0
        ]
      )
      return
    }

    let uris = queue.compactMap { spotifyUri(from: $0) }.filter { $0.starts(with: "spotify:track:") }
    try await spotifyRequest(
      path: path,
      method: "PUT",
      body: [
        "uris": uris.isEmpty ? [uri] : uris,
        "position_ms": 0
      ]
    )
  }

  private func startSpotifyPlaybackWithAppRemote(uri: String) async throws {
    configureAppRemote()
    try await appRemoteCoordinator.play(uri: uri)
  }

  private func searchSpotifyTracks(query: String, limit: Int) async throws -> [[String: Any?]] {
    guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      return []
    }

    var components = URLComponents()
    components.path = "/v1/search"
    components.queryItems = [
      URLQueryItem(name: "type", value: "track"),
      URLQueryItem(name: "limit", value: String(limit)),
      URLQueryItem(name: "q", value: query)
    ]
    let json = try await spotifyJSONRequest(path: components.string ?? "/v1/search?type=track&limit=\(limit)", method: "GET")
    let tracks = json?["tracks"] as? [String: Any]
    let items = tracks?["items"] as? [[String: Any]] ?? []
    return items.map(serializeSpotifyTrack)
  }

  private func getUserSpotifyPlaylists(limit: Int) async throws -> [[String: Any?]] {
    var components = URLComponents()
    components.path = "/v1/me/playlists"
    components.queryItems = [
      URLQueryItem(name: "limit", value: String(limit)),
      URLQueryItem(name: "offset", value: "0")
    ]
    let json = try await spotifyJSONRequest(path: components.string ?? "/v1/me/playlists?limit=\(limit)&offset=0", method: "GET")
    let items = json?["items"] as? [[String: Any]] ?? []
    return items.map(serializeSpotifyPlaylist)
  }

  private func getUserSpotifyTopTracks(limit: Int) async throws -> [[String: Any?]] {
    var components = URLComponents()
    components.path = "/v1/me/top/tracks"
    components.queryItems = [
      URLQueryItem(name: "limit", value: String(limit)),
      URLQueryItem(name: "time_range", value: "medium_term")
    ]
    let json = try await spotifyJSONRequest(path: components.string ?? "/v1/me/top/tracks?limit=\(limit)&time_range=medium_term", method: "GET")
    let items = json?["items"] as? [[String: Any]] ?? []
    return items.map(serializeSpotifyTrack)
  }

  private func getSpotifyRecentlyPlayedTracks(limit: Int) async throws -> [[String: Any?]] {
    var components = URLComponents()
    components.path = "/v1/me/player/recently-played"
    components.queryItems = [
      URLQueryItem(name: "limit", value: String(limit))
    ]
    let json = try await spotifyJSONRequest(path: components.string ?? "/v1/me/player/recently-played?limit=\(limit)", method: "GET")
    let items = json?["items"] as? [[String: Any]] ?? []
    return items.compactMap { item in
      guard let track = item["track"] as? [String: Any] else {
        return nil
      }
      var serialized = serializeSpotifyTrack(track)
      serialized["playedAt"] = firstString(item, keys: ["played_at"]) ?? ""
      return serialized
    }
  }

  private func getSpotifyPlaylistTracks(playlistId: String, limit: Int) async throws -> [[String: Any?]] {
    let trimmedPlaylistId = playlistId.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedPlaylistId.isEmpty else {
      return []
    }

    var components = URLComponents()
    components.path = "/v1/playlists/\(trimmedPlaylistId)/tracks"
    components.queryItems = [
      URLQueryItem(name: "limit", value: String(limit)),
      URLQueryItem(name: "offset", value: "0"),
      URLQueryItem(name: "market", value: "KR")
    ]
    let json = try await spotifyJSONRequest(
      path: components.string ?? "/v1/playlists/\(trimmedPlaylistId)/tracks?limit=\(limit)&offset=0&market=KR",
      method: "GET"
    )
    let items = json?["items"] as? [[String: Any]] ?? []
    return items.compactMap { item in
      guard let track = item["track"] as? [String: Any],
            firstString(track, keys: ["type"]) == nil || firstString(track, keys: ["type"]) == "track" else {
        return nil
      }
      return serializeSpotifyTrack(track)
    }
  }

  private func resolvePlayableTracks(_ tracks: [[String: Any]]) async throws -> [[String: Any?]] {
    var resolved: [[String: Any?]] = []
    for track in tracks {
      if spotifyUri(from: track) != nil {
        resolved.append(track.mapValues { Optional($0) })
        continue
      }

      let query = [firstString(track, keys: ["title", "name"]), firstString(track, keys: ["artist", "artistName"])]
        .compactMap { $0 }
        .joined(separator: " ")
      if let match = try await searchSpotifyTracks(query: query, limit: 1).first {
        resolved.append(mergeTrackPayload(track, match: match))
      }
    }
    return resolved
  }

  private func refreshPlayerState() async {
    guard accessToken != nil else {
      return
    }

    do {
      guard let json = try await spotifyJSONRequest(path: "/v1/me/player/currently-playing", method: "GET") else {
        return
      }

      isPlaying = (json["is_playing"] as? Bool) ?? isPlaying
      positionMs = (json["progress_ms"] as? Int) ?? positionMs
      playbackStatus = isPlaying ? "playing" : "paused"

      if let item = json["item"] as? [String: Any] {
        let liveTrack = serializeSpotifyTrack(item)
        currentTrack = liveTrack
        if let uri = liveTrack["spotifyUri"] as? String {
          let matchingIndex = playbackQueue.firstIndex { queuedTrack in
            spotifyUri(from: queuedTrack) == uri || queuedTrack["id"] as? String == uri
          }
          if let matchingIndex {
            currentQueueIndex = matchingIndex
          }
        }
      }
    } catch {
      playbackStatus = accessToken == nil ? "idle" : playbackStatus
    }
  }

  private func applyTokenResponse(_ json: [String: Any]) {
    accessToken = json["access_token"] as? String
    if let nextRefreshToken = json["refresh_token"] as? String {
      refreshToken = nextRefreshToken
    }
    let expiresIn = json["expires_in"] as? Double ?? 3600
    tokenExpiresAt = Date().addingTimeInterval(expiresIn)
    persistSpotifySession()
    appRemoteCoordinator.setAccessToken(accessToken)
    configureAppRemote()
  }

  private func loadPersistedSpotifySession() {
    let defaults = UserDefaults.standard
    if accessToken == nil {
      accessToken = defaults.string(forKey: tokenStorageAccessTokenKey)
    }
    if refreshToken == nil {
      refreshToken = defaults.string(forKey: tokenStorageRefreshTokenKey)
    }
    if tokenExpiresAt == nil {
      let rawExpiresAt = defaults.double(forKey: tokenStorageExpiresAtKey)
      if rawExpiresAt > 0 {
        tokenExpiresAt = Date(timeIntervalSince1970: rawExpiresAt)
      }
    }
  }

  private func persistSpotifySession() {
    let defaults = UserDefaults.standard
    if let accessToken {
      defaults.set(accessToken, forKey: tokenStorageAccessTokenKey)
    } else {
      defaults.removeObject(forKey: tokenStorageAccessTokenKey)
    }
    if let refreshToken {
      defaults.set(refreshToken, forKey: tokenStorageRefreshTokenKey)
    } else {
      defaults.removeObject(forKey: tokenStorageRefreshTokenKey)
    }
    if let tokenExpiresAt {
      defaults.set(tokenExpiresAt.timeIntervalSince1970, forKey: tokenStorageExpiresAtKey)
    } else {
      defaults.removeObject(forKey: tokenStorageExpiresAtKey)
    }
  }

  private func applyAppRemotePlayerState(_ payload: [String: Any?]) {
    let nextUri = payload["spotifyUri"] as? String ?? payload["uri"] as? String ?? ""
    let previousUri = currentTrack?["spotifyUri"] as? String ?? currentTrack?["uri"] as? String ?? ""
    let retainedArtworkUrl = nextUri == previousUri ? currentTrack?["artworkUrl"] ?? "" : ""

    currentTrack = [
      "id": nextUri,
      "spotifyUri": payload["spotifyUri"] ?? "",
      "uri": payload["uri"] ?? "",
      "provider": "spotify",
      "title": payload["title"] ?? "Unknown Track",
      "artist": payload["artist"] ?? "Unknown Artist",
      "album": payload["album"] ?? "",
      "artworkUrl": retainedArtworkUrl,
      "durationMs": payload["durationMs"] ?? 0
    ]
    positionMs = payload["positionMs"] as? Int ?? positionMs
    isPlaying = payload["isPlaying"] as? Bool ?? isPlaying
    playbackStatus = isPlaying ? "playing" : "paused"
    lastError = nil
    emitState()
  }

  private func applyAppRemoteStatus(_ status: String, error: String?) {
    if status == "appRemotePlaying" {
      isPlaying = true
      playbackStatus = "playing"
    } else if status == "appRemoteDisconnected" {
      playbackStatus = isPlaying ? "playing" : "paused"
    } else {
      playbackStatus = status
    }

    if let error, !error.isEmpty {
      lastError = error
    } else if !status.lowercased().contains("error") && status != "appRemoteConnectionFailed" {
      lastError = nil
    }

    emitState()
  }

  private func serializeSpotifyTrack(_ item: [String: Any]) -> [String: Any?] {
    let album = item["album"] as? [String: Any]
    let images = album?["images"] as? [[String: Any]]
    let artists = item["artists"] as? [[String: Any]]
    let uri = firstString(item, keys: ["uri"]) ?? ""

    return [
      "id": firstString(item, keys: ["id"]) ?? uri,
      "spotifyUri": uri,
      "uri": uri,
      "provider": "spotify",
      "title": firstString(item, keys: ["name"]) ?? "Unknown Track",
      "artist": firstString(artists?.first ?? [:], keys: ["name"]) ?? "Unknown Artist",
      "album": firstString(album ?? [:], keys: ["name"]) ?? "",
      "artworkUrl": firstString(images?.first ?? [:], keys: ["url"]) ?? "",
      "durationMs": item["duration_ms"] as? Int ?? 0
    ]
  }

  private func serializeSpotifyPlaylist(_ item: [String: Any]) -> [String: Any?] {
    let images = item["images"] as? [[String: Any]]
    let owner = item["owner"] as? [String: Any]
    let tracks = item["tracks"] as? [String: Any]
    let uri = firstString(item, keys: ["uri"]) ?? ""

    return [
      "id": firstString(item, keys: ["id"]) ?? uri,
      "type": "playlist",
      "spotifyUri": uri,
      "uri": uri,
      "provider": "spotify",
      "title": firstString(item, keys: ["name"]) ?? "Spotify Playlist",
      "artist": firstString(owner ?? [:], keys: ["display_name"]) ?? "Spotify",
      "ownerName": firstString(owner ?? [:], keys: ["display_name"]) ?? "",
      "album": "",
      "artworkUrl": firstString(images?.first ?? [:], keys: ["url"]) ?? "",
      "durationMs": 0,
      "trackCount": tracks?["total"] as? Int ?? 0
    ]
  }

  private func mergeTrackPayload(_ track: [String: Any], match: [String: Any?]) -> [String: Any?] {
    var payload = match
    for (key, value) in track {
      if payload[key] == nil {
        payload[key] = value
      }
    }
    payload["provider"] = "spotify"
    return payload
  }

  private func openSpotify(uri: String) {
    guard let openURL = URL(string: uri) ?? URL(string: "spotify:") else {
      return
    }

    DispatchQueue.main.async {
      UIApplication.shared.open(openURL)
    }
  }

  private func advanceQueueIndex(_ offset: Int) {
    guard !playbackQueue.isEmpty else {
      return
    }

    currentQueueIndex = min(max(currentQueueIndex + offset, 0), playbackQueue.count - 1)
    currentTrack = playbackQueue[currentQueueIndex]
  }

  private func currentState() -> [String: Any?] {
    [
      "provider": "spotify",
      "available": true,
      "isConnected": hasValidAccessToken(),
      "isPlaying": isPlaying,
      "playbackStatus": playbackStatus,
      "positionMs": positionMs,
      "currentTrack": currentTrack,
      "queue": playbackQueue,
      "authorizationStatus": hasValidAccessToken() ? "authorized" : "notDetermined",
      "isAuthorized": hasValidAccessToken(),
      "error": lastError,
      "requiresActiveDevice": playbackStatus == "noActiveDevice"
    ]
  }

  private func emitState() {
    sendEvent("onPlaybackStateChanged", currentState())
  }

  private func playbackErrorState(_ error: SpotifyAPIError) -> [String: Any?] {
    isPlaying = false
    positionMs = 0
    playbackStatus = isNoActiveDeviceError(error) ? "noActiveDevice" : "playbackError"
    lastError = userFacingPlaybackMessage(for: error)
    emitState()
    return currentState()
  }

  private func userFacingPlaybackMessage(for error: SpotifyAPIError) -> String {
    if isNoActiveDeviceError(error) {
      return "Spotify 앱으로 해당 곡을 여는 데 실패했어요. NOWHERE에서 곡을 다시 선택해주세요."
    }

    if error.statusCode == 403 {
      return "Spotify에서 현재 재생 요청을 허용하지 않았습니다. 앱은 계속 사용할 수 있으며 잠시 후 다시 시도해주세요."
    }

    return "Spotify 재생 요청이 실패했어요. \(error.message)"
  }

  private func spotifyUri(from track: [String: Any?]) -> String? {
    for key in ["spotifyUri", "uri", "playlistId", "id"] {
      if let value = track[key] as? String, value.starts(with: "spotify:") {
        return value
      }
    }
    return nil
  }

  private func spotifyUri(from track: [String: Any]) -> String? {
    for key in ["spotifyUri", "uri", "playlistId", "id"] {
      if let value = track[key] as? String, value.starts(with: "spotify:") {
        return value
      }
    }
    return nil
  }

  private func firstString(_ source: [String: Any], keys: [String]) -> String? {
    for key in keys {
      if let value = source[key] as? String, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        return value
      }
    }
    return nil
  }

  private func firstBool(_ source: [String: Any], keys: [String]) -> Bool {
    for key in keys {
      if let value = source[key] as? Bool {
        return value
      }
      if let value = source[key] as? String {
        let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if ["true", "1", "yes"].contains(normalized) {
          return true
        }
      }
    }
    return false
  }

  private func parseJSONObject(_ data: Data) throws -> [String: Any] {
    let json = try JSONSerialization.jsonObject(with: data)
    guard let object = json as? [String: Any] else {
      throw NowherePlayerException("Spotify response JSON was invalid.")
    }
    return object
  }

  private func parseSpotifyAPIError(_ data: Data, statusCode: Int) -> SpotifyAPIError {
    var message = String(data: data, encoding: .utf8) ?? "Spotify request failed with HTTP \(statusCode)."
    var reason: String?
    var nextStatusCode = statusCode

    if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
      if let error = json["error"] as? [String: Any] {
        message = firstString(error, keys: ["message"]) ?? message
        reason = firstString(error, keys: ["reason"])
        nextStatusCode = error["status"] as? Int ?? statusCode
      } else {
        message = firstString(json, keys: ["error_description", "message", "error"]) ?? message
      }
    }

    if nextStatusCode == 403 {
      message = "Spotify에서 현재 요청을 허용하지 않았습니다. 앱은 계속 사용할 수 있으며 잠시 후 다시 시도해주세요."
    }

    return SpotifyAPIError(statusCode: nextStatusCode, message: message, reason: reason)
  }

  private func isNoActiveDeviceError(_ error: SpotifyAPIError) -> Bool {
    error.statusCode == 404 &&
      (error.reason == "NO_ACTIVE_DEVICE" ||
        error.message.localizedCaseInsensitiveContains("No active device"))
  }

  private func formEncoded(_ payload: [String: String]) -> String {
    payload
      .map { key, value in
        "\(urlEncode(key))=\(urlEncode(value))"
      }
      .joined(separator: "&")
  }

  private func urlEncode(_ value: String) -> String {
    value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? value
  }

  private func randomString(length: Int) -> String {
    let characters = Array("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~")
    return String((0..<length).map { _ in characters[Int.random(in: 0..<characters.count)] })
  }

  private func codeChallenge(for verifier: String) -> String {
    let data = Data(verifier.utf8)
    let digest = SHA256.hash(data: data)
    return Data(digest).base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }

  private func extractDominantAlbumColor(urlString: String) async throws -> String {
    try await Task.detached(priority: .utility) {
      guard let url = URL(string: urlString), !urlString.isEmpty else {
        throw NowherePlayerException("Album artwork URL is invalid.")
      }
      let data = try Data(contentsOf: url)
      guard let image = UIImage(data: data), let cgImage = image.cgImage else {
        throw NowherePlayerException("Album artwork could not be decoded.")
      }

      let width = 32
      let height = 32
      let bytesPerPixel = 4
      let bytesPerRow = width * bytesPerPixel
      var pixels = [UInt8](repeating: 0, count: width * height * bytesPerPixel)
      let colorSpace = CGColorSpaceCreateDeviceRGB()
      guard let context = CGContext(
        data: &pixels,
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: bytesPerRow,
        space: colorSpace,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
      ) else {
        throw NowherePlayerException("Album artwork canvas could not be created.")
      }

      context.interpolationQuality = .medium
      context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))

      var buckets: [String: (count: Int, red: Int, green: Int, blue: Int)] = [:]
      var redTotal = 0
      var greenTotal = 0
      var blueTotal = 0
      var averageCount = 0

      stride(from: 0, to: pixels.count, by: 4).forEach { index in
        let red = Int(pixels[index])
        let green = Int(pixels[index + 1])
        let blue = Int(pixels[index + 2])
        let alpha = Int(pixels[index + 3])
        guard alpha >= 180 else { return }

        redTotal += red
        greenTotal += green
        blueTotal += blue
        averageCount += 1

        let luma = (0.2126 * Double(red)) + (0.7152 * Double(green)) + (0.0722 * Double(blue))
        guard luma >= 24, luma <= 238 else { return }

        let bucketRed = min(255, Int((Double(red) / 24.0).rounded()) * 24)
        let bucketGreen = min(255, Int((Double(green) / 24.0).rounded()) * 24)
        let bucketBlue = min(255, Int((Double(blue) / 24.0).rounded()) * 24)
        let key = "\(bucketRed),\(bucketGreen),\(bucketBlue)"
        let current = buckets[key] ?? (count: 0, red: bucketRed, green: bucketGreen, blue: bucketBlue)
        buckets[key] = (count: current.count + 1, red: bucketRed, green: bucketGreen, blue: bucketBlue)
      }

      if let dominant = buckets.values.max(by: { $0.count < $1.count }) {
        return String(format: "#%02X%02X%02X", dominant.red, dominant.green, dominant.blue)
      }

      guard averageCount > 0 else {
        throw NowherePlayerException("Album artwork did not contain usable pixels.")
      }
      return String(
        format: "#%02X%02X%02X",
        redTotal / averageCount,
        greenTotal / averageCount,
        blueTotal / averageCount
      )
    }.value
  }
}

private final class AuthPresentationContextProvider: NSObject, ASWebAuthenticationPresentationContextProviding {
  func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    return scenes.flatMap { $0.windows }.first { $0.isKeyWindow } ?? ASPresentationAnchor()
  }
}

private struct SpotifyAPIError: LocalizedError, CustomStringConvertible, @unchecked Sendable {
  let statusCode: Int
  let message: String
  let reason: String?

  var errorDescription: String? {
    if let reason {
      return "\(message) (\(reason))"
    }
    return message
  }

  var description: String {
    errorDescription ?? message
  }
}

private final class NowherePlayerException: GenericException<String>, @unchecked Sendable {
  override var reason: String {
    return param
  }
}
