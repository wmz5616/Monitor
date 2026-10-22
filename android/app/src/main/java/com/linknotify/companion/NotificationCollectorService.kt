package com.linknotify.companion

import android.app.Notification
import android.content.Context
import android.content.Intent
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import org.json.JSONObject

class NotificationCollectorService : NotificationListenerService() {

    companion object {
        private const val TAG = "NotifyCollector"
        const val ACTION_NOTIFICATION_COLLECTED = "com.linknotify.ACTION_NOTIFICATION_COLLECTED"
        const val EXTRA_PAYLOAD = "extra_payload"
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        super.onNotificationPosted(sbn)
        if (sbn == null) return

        val pkgName = sbn.packageName ?: ""
        // 忽略自身应用的通知
        if (pkgName == packageName) return

        val extras = sbn.notification.extras ?: return
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: ""
        val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: ""
        val subText = extras.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString() ?: ""

        if (title.isBlank() && text.isBlank()) return

        // 识别来源类型
        val isSms = pkgName.contains("mms") || pkgName.contains("messaging") || pkgName.contains("telephony")
        val sourceType = if (isSms) "sms" else "app"

        // 获取应用中文名称与真实高清应用图标 (除了短信外全部提取具体应用图标)
        val pm = applicationContext.packageManager
        val appName = try {
            val appInfo = pm.getApplicationInfo(pkgName, 0)
            pm.getApplicationLabel(appInfo).toString()
        } catch (e: Exception) {
            pkgName
        }

        var appIconBase64 = ""
        if (!isSms) {
            try {
                val drawable = pm.getApplicationIcon(pkgName)
                val width = if (drawable.intrinsicWidth > 0) drawable.intrinsicWidth else 72
                val height = if (drawable.intrinsicHeight > 0) drawable.intrinsicHeight else 72
                val bitmap = android.graphics.Bitmap.createBitmap(width, height, android.graphics.Bitmap.Config.ARGB_8888)
                val canvas = android.graphics.Canvas(bitmap)
                drawable.setBounds(0, 0, canvas.width, canvas.height)
                drawable.draw(canvas)

                // 统一裁剪缩放为 56x56 紧凑尺寸以保证跨网即时传输
                val scaled = android.graphics.Bitmap.createScaledBitmap(bitmap, 56, 56, true)
                val baos = java.io.ByteArrayOutputStream()
                scaled.compress(android.graphics.Bitmap.CompressFormat.PNG, 85, baos)
                appIconBase64 = "data:image/png;base64," + android.util.Base64.encodeToString(baos.toByteArray(), android.util.Base64.NO_WRAP)
            } catch (ignored: Exception) {}
        }

        val fullContent = if (subText.isNotBlank()) "[$subText] $text" else text

        // 获取本机真实设备名，杜绝写死假内容
        val realDeviceName = try {
            android.provider.Settings.Global.getString(contentResolver, "device_name") ?: ""
        } catch (e: Exception) { "" }.ifBlank {
            android.os.Build.MODEL ?: "Android"
        }

        // 组装标准跨网消息结构体
        val jsonPayload = JSONObject().apply {
            put("id", sbn.key)
            put("deviceId", android.os.Build.SERIAL ?: "device")
            put("deviceName", realDeviceName)
            put("packageName", pkgName)
            put("appName", appName)
            put("sourceType", sourceType)
            put("icon", appIconBase64)
            put("title", if (title.isNotBlank()) title else appName)
            put("content", fullContent)
            put("timestamp", sbn.postTime)
        }

        val payloadStr = jsonPayload.toString()
        Log.i(TAG, "捕获通知: [$appName] $title - $fullContent")

        // 1. 读取本地配对码与角色配置
        val sp = getSharedPreferences("link_notify_config", Context.MODE_PRIVATE)
        val role = sp.getString("role", "B") ?: "B"
        val pairCode = sp.getString("pair_code", "") ?: ""

        // 备用机角色且已生成/配置配对码时，自动跨网广播
        if (role == "B" && pairCode.length >= 6) {
            MqttDispatcher.dispatch(this, pairCode, payloadStr)
        }

        // 2. 发送本地广播通知前台界面刷新 (若正在查看)
        val intent = Intent(ACTION_NOTIFICATION_COLLECTED).apply {
            putExtra(EXTRA_PAYLOAD, payloadStr)
            setPackage(packageName)
        }
        sendBroadcast(intent)
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {
        super.onNotificationRemoved(sbn)
    }
}
