package io.github.quickhardsub

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import com.arthenica.ffmpegkit.FFmpegKit

class EncodeService : Service() {
    companion object {
        const val CHANNEL_ID = "native_encode"
        const val NOTIFICATION_ID = 1402
        const val ACTION_CANCEL = "io.github.quickhardsub.action.CANCEL_ENCODE"
    }

    override fun onCreate() {
        super.onCreate()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "硬字幕压制",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "显示 Android 原生硬字幕压制进度"
                setSound(null, null)
            }
            getSystemService(NotificationManager::class.java)
                .createNotificationChannel(channel)
        }
    }

    private fun buildNotification(text: String): Notification {
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }

        return builder
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setContentTitle("快捷自动硬字幕压制器")
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build()
    }

    private fun promote(text: String) {
        val notification = buildNotification(text)
        if (Build.VERSION.SDK_INT >= 35) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROCESSING
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun stopEncodeService() {
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_CANCEL) {
            FFmpegKit.cancel()
            stopEncodeService()
            return START_NOT_STICKY
        }

        // Formal encode requests will be handed to this service by a structured
        // bridge. Starting the service and promoting it must remain a direct
        // consequence of a foreground user action.
        promote("准备 Android 原生压制…")
        return START_NOT_STICKY
    }

    override fun onTimeout(startId: Int, fgsType: Int) {
        FFmpegKit.cancel()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf(startId)
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
