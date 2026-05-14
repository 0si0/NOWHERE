package com.nowhere.player

import android.Manifest
import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build

class NowherePlaybackNotificationReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != ACTION_SHOW_PLAYBACK_NOTIFICATION) {
      return
    }
    showNotification(context, intent)
  }

  companion object {
    private const val ACTION_SHOW_PLAYBACK_NOTIFICATION = "com.nowhere.player.SHOW_PLAYBACK_NOTIFICATION"
    private const val CHANNEL_ID = "nowhere_music_map_playback"
    private const val PREFS_NAME = "nowhere_playback_notifications"
    private const val IDENTIFIERS_KEY = "identifiers"

    fun schedule(context: Context, options: Map<String, Any?>) {
      val identifier = (options["identifier"] as? String).takeUnless { it.isNullOrBlank() }
        ?: "nowhere-music-map-sequential"
      val delayMs = ((options["delayMs"] as? Number)?.toLong() ?: 1000L).coerceAtLeast(1000L)
      val notificationId = notificationIdFor(identifier)
      val intent = Intent(context, NowherePlaybackNotificationReceiver::class.java).apply {
        action = ACTION_SHOW_PLAYBACK_NOTIFICATION
        putExtra("identifier", identifier)
        putExtra("notificationId", notificationId)
        putExtra("title", options["title"] as? String ?: "다음 곡을 재생할 시간이에요")
        putExtra("body", options["body"] as? String ?: "잠금화면에서 탭하면 Spotify로 열어요.")
        putExtra("url", options["url"] as? String ?: "com.nowhere.nowhere://spotify-auth")
      }
      val pendingIntent = PendingIntent.getBroadcast(
        context,
        notificationId,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
      val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      val triggerAt = System.currentTimeMillis() + delayMs
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent)
      } else {
        alarmManager.set(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent)
      }
      rememberIdentifier(context, identifier)
    }

    fun cancel(context: Context, prefix: String): Int {
      val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      val identifiers = prefs.getStringSet(IDENTIFIERS_KEY, emptySet()).orEmpty().toMutableSet()
      val targets = identifiers.filter { prefix.isBlank() || it.startsWith(prefix) }
      val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      targets.forEach { identifier ->
        val notificationId = notificationIdFor(identifier)
        val pendingIntent = PendingIntent.getBroadcast(
          context,
          notificationId,
          Intent(context, NowherePlaybackNotificationReceiver::class.java).apply {
            action = ACTION_SHOW_PLAYBACK_NOTIFICATION
          },
          PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
        )
        pendingIntent?.let {
          alarmManager.cancel(it)
          it.cancel()
        }
        notificationManager.cancel(notificationId)
        identifiers.remove(identifier)
      }
      prefs.edit().putStringSet(IDENTIFIERS_KEY, identifiers).apply()
      return targets.size
    }

    private fun showNotification(context: Context, intent: Intent) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
        context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
      ) {
        return
      }

      val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      ensureChannel(notificationManager)

      val url = intent.getStringExtra("url") ?: "com.nowhere.nowhere://spotify-auth"
      val launchIntent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
        setPackage(context.packageName)
        addCategory(Intent.CATEGORY_BROWSABLE)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
      }
      val contentIntent = PendingIntent.getActivity(
        context,
        intent.getIntExtra("notificationId", 0),
        launchIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )

      val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        Notification.Builder(context, CHANNEL_ID)
      } else {
        @Suppress("DEPRECATION")
        Notification.Builder(context)
      }
      val notification = builder
        .setSmallIcon(context.applicationInfo.icon)
        .setContentTitle(intent.getStringExtra("title") ?: "다음 곡을 재생할 시간이에요")
        .setContentText(intent.getStringExtra("body") ?: "잠금화면에서 탭하면 Spotify로 열어요.")
        .setStyle(Notification.BigTextStyle().bigText(intent.getStringExtra("body") ?: "잠금화면에서 탭하면 Spotify로 열어요."))
        .setContentIntent(contentIntent)
        .setAutoCancel(true)
        .setCategory(Notification.CATEGORY_REMINDER)
        .setPriority(Notification.PRIORITY_HIGH)
        .build()

      notificationManager.notify(intent.getIntExtra("notificationId", 0), notification)
    }

    private fun ensureChannel(notificationManager: NotificationManager) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
        return
      }
      val existing = notificationManager.getNotificationChannel(CHANNEL_ID)
      if (existing != null) {
        return
      }
      val channel = NotificationChannel(
        CHANNEL_ID,
        "Music Map playback",
        NotificationManager.IMPORTANCE_HIGH
      ).apply {
        description = "NOWHERE Music Map sequential playback reminders"
      }
      notificationManager.createNotificationChannel(channel)
    }

    private fun rememberIdentifier(context: Context, identifier: String) {
      val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      val identifiers = prefs.getStringSet(IDENTIFIERS_KEY, emptySet()).orEmpty().toMutableSet()
      identifiers.add(identifier)
      prefs.edit().putStringSet(IDENTIFIERS_KEY, identifiers).apply()
    }

    private fun notificationIdFor(identifier: String): Int {
      return identifier.hashCode().let { if (it == Int.MIN_VALUE) 1 else kotlin.math.abs(it) }
    }
  }
}
