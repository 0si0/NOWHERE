import Foundation
import SpotifyiOS
import UIKit

private let appRemoteScopes = [
  "app-remote-control",
  "user-read-playback-state",
  "user-modify-playback-state",
  "playlist-read-private",
  "playlist-read-collaborative"
]

final class SpotifyAppRemoteCoordinator: NSObject, SPTAppRemoteDelegate, SPTAppRemotePlayerStateDelegate, @unchecked Sendable {
  static let shared = SpotifyAppRemoteCoordinator()

  var onPlayerState: (([String: Any?]) -> Void)?
  var onStatus: ((String, String?) -> Void)?

  private var clientId = ""
  private var redirectURL: URL?
  private var appRemote: SPTAppRemote?
  private var pendingPlayURI: String?
  private var tokenObserver: NSObjectProtocol?
  private var lifecycleObservers: [NSObjectProtocol] = []

  private override init() {
    super.init()
    tokenObserver = NotificationCenter.default.addObserver(
      forName: Notification.Name("NowhereSpotifyOpenURL"),
      object: nil,
      queue: .main
    ) { [weak self] notification in
      guard let url = notification.object as? URL else { return }
      self?.handleOpenURL(url)
    }
    lifecycleObservers = [
      NotificationCenter.default.addObserver(
        forName: UIApplication.willResignActiveNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        self?.disconnect()
      },
      NotificationCenter.default.addObserver(
        forName: UIApplication.didBecomeActiveNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        self?.connectIfAuthorized()
      }
    ]
  }

  deinit {
    if let tokenObserver {
      NotificationCenter.default.removeObserver(tokenObserver)
    }
    lifecycleObservers.forEach(NotificationCenter.default.removeObserver)
  }

  func configure(clientId: String, redirectUri: String, accessToken: String?) {
    guard let redirectURL = URL(string: redirectUri), !clientId.isEmpty else {
      return
    }

    if self.clientId == clientId, self.redirectURL == redirectURL, appRemote != nil {
      if let accessToken {
        appRemote?.connectionParameters.accessToken = accessToken
      }
      return
    }

    self.clientId = clientId
    self.redirectURL = redirectURL

    let configuration = SPTConfiguration(clientID: clientId, redirectURL: redirectURL)
    configuration.playURI = ""
    configuration.companyName = "NOWHERE"

    let remote = SPTAppRemote(configuration: configuration, logLevel: .error)
    remote.delegate = self
    if let accessToken {
      remote.connectionParameters.accessToken = accessToken
    }
    appRemote = remote
  }

  func setAccessToken(_ accessToken: String?) {
    appRemote?.connectionParameters.accessToken = accessToken
  }

  func disconnect() {
    if appRemote?.isConnected == true {
      appRemote?.disconnect()
    }
  }

  private func connectIfAuthorized() {
    guard let appRemote, appRemote.connectionParameters.accessToken != nil, !appRemote.isConnected else {
      return
    }
    appRemote.connect()
  }

  func play(uri: String) async throws {
    let playURI = uri.trimmingCharacters(in: .whitespacesAndNewlines)

    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      DispatchQueue.main.async { [weak self] in
        guard let self else {
          continuation.resume(throwing: SpotifyAppRemoteError(message: "Spotify App Remote is unavailable."))
          return
        }
        self.playOnMain(uri: playURI, continuation: continuation)
      }
    }
  }

  private func playOnMain(uri playURI: String, continuation: CheckedContinuation<Void, Error>) {
    guard let appRemote else {
      continuation.resume(throwing: SpotifyAppRemoteError(message: "Spotify App Remote is not configured."))
      return
    }

    if appRemote.isConnected {
      guard let playerAPI = appRemote.playerAPI else {
        continuation.resume(throwing: SpotifyAppRemoteError(message: "Spotify App Remote player API is not ready."))
        return
      }

      let callback: SPTAppRemoteCallback = { _, error in
        if let error {
          continuation.resume(throwing: error)
        } else {
          continuation.resume()
        }
      }
      if playURI.isEmpty {
        playerAPI.resume(callback)
      } else {
        playerAPI.play(playURI, callback: callback)
      }
      return
    }

    pendingPlayURI = playURI
    onStatus?("appRemoteOpeningSpotify", nil)
    appRemote.authorizeAndPlayURI(
      playURI,
      asRadio: false,
      additionalScopes: appRemoteScopes
    ) { [weak self] success in
      guard success else {
        self?.pendingPlayURI = nil
        continuation.resume(throwing: SpotifyAppRemoteError(message: "Spotify 앱을 열 수 없습니다. Spotify가 설치되어 있는지 확인해주세요."))
        return
      }

      self?.onStatus?("appRemoteAwaitingSpotify", nil)
      continuation.resume()
    }
  }

  func handleOpenURL(_ url: URL) {
    guard let appRemote else { return }
    guard let parameters = appRemote.authorizationParameters(from: url) else {
      return
    }

    if let token = parameters[SPTAppRemoteAccessTokenKey] {
      appRemote.connectionParameters.accessToken = token
      onStatus?("appRemoteAuthorized", nil)
      if appRemote.isConnected {
        playPendingURIIfNeeded()
      } else {
        appRemote.connect()
      }
      return
    }

    if let errorDescription = parameters[SPTAppRemoteErrorDescriptionKey] {
      onStatus?("appRemoteError", errorDescription)
      pendingPlayURI = nil
    }
  }

  func appRemoteDidEstablishConnection(_ appRemote: SPTAppRemote) {
    onStatus?("appRemoteConnected", nil)
    appRemote.playerAPI?.delegate = self
    appRemote.playerAPI?.subscribe(toPlayerState: { [weak self] _, error in
      if let error {
        self?.onStatus?("appRemotePlayerStateError", error.localizedDescription)
      }
    })
    playPendingURIIfNeeded()
  }

  func appRemote(_ appRemote: SPTAppRemote, didFailConnectionAttemptWithError error: Error?) {
    onStatus?("appRemoteConnectionFailed", error?.localizedDescription)
  }

  func appRemote(_ appRemote: SPTAppRemote, didDisconnectWithError error: Error?) {
    onStatus?("appRemoteDisconnected", error?.localizedDescription)
  }

  func playerStateDidChange(_ playerState: SPTAppRemotePlayerState) {
    let track = playerState.track
    onPlayerState?([
      "spotifyUri": track.uri,
      "uri": track.uri,
      "provider": "spotify",
      "title": track.name,
      "artist": track.artist.name,
      "album": track.album.name,
      "durationMs": track.duration,
      "positionMs": playerState.playbackPosition,
      "isPlaying": !playerState.isPaused
    ])
  }

  private func playPendingURIIfNeeded() {
    guard let uri = pendingPlayURI, let appRemote, appRemote.isConnected else {
      return
    }

    guard let playerAPI = appRemote.playerAPI else {
      onStatus?("appRemotePlaybackError", "Spotify App Remote player API is not ready.")
      return
    }

    pendingPlayURI = nil
    let callback: SPTAppRemoteCallback = { [weak self] _, error in
      if let error {
        self?.onStatus?("appRemotePlaybackError", error.localizedDescription)
      } else {
        self?.onStatus?("appRemotePlaying", nil)
      }
    }
    if uri.isEmpty {
      playerAPI.resume(callback)
    } else {
      playerAPI.play(uri, callback: callback)
    }
  }
}

private struct SpotifyAppRemoteError: LocalizedError {
  let message: String

  var errorDescription: String? {
    message
  }
}
