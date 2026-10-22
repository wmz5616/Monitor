package com.linknotify.companion

import android.annotation.SuppressLint
import android.content.BroadcastReceiver
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.Settings
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var notificationReceiver: BroadcastReceiver? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        initWebView()

        // 注册本地广播监听后台采集服务的通知分发
        notificationReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                val payload = intent?.getStringExtra(NotificationCollectorService.EXTRA_PAYLOAD) ?: return
                runOnUiThread {
                    val safePayload = payload.replace("\\", "\\\\").replace("'", "\\'")
                    val js = "if (window.LinkNotifyNative && window.LinkNotifyNative.onNotificationCollected) { window.LinkNotifyNative.onNotificationCollected('$safePayload'); }"
                    webView.evaluateJavascript(js, null)
                }
            }
        }

        val filter = IntentFilter(NotificationCollectorService.ACTION_NOTIFICATION_COLLECTED)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(notificationReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(notificationReceiver, filter)
        }

        // 载入本地打包的 Liquid-Glass 工作台 (彻底脱离局域网与外部网页依赖)
        webView.loadUrl("file:///android_asset/web/index.html")
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun initWebView() {
        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.allowFileAccess = true
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true

        webView.webChromeClient = WebChromeClient()
        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
            }
        }

        // 注入 Android 原生核心能力接口
        webView.addJavascriptInterface(NativeBridge(this), "AndroidNative")
    }

    override fun onResume() {
        super.onResume()
        webView.evaluateJavascript("if (window.LinkNotifyNative && window.LinkNotifyNative.onAppResume) { window.LinkNotifyNative.onAppResume(); }", null)
    }

    override fun onDestroy() {
        super.onDestroy()
        if (notificationReceiver != null) {
            try {
                unregisterReceiver(notificationReceiver)
            } catch (ignored: Exception) {}
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    /**
     * 原生与 JS 桥接接口
     */
    inner class NativeBridge(private val context: Context) {

        @JavascriptInterface
        fun copyToClipboard(text: String) {
            runOnUiThread {
                val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                val clip = ClipData.newPlainText("LinkNotify", text)
                clipboard.setPrimaryClip(clip)
                Toast.makeText(context, "已复制", Toast.LENGTH_SHORT).show()
                vibrate()
            }
        }

        @JavascriptInterface
        fun openNotificationSettings() {
            val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
        }

        @JavascriptInterface
        fun requestBatteryOptimization() {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                try {
                    val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                        data = Uri.parse("package:${context.packageName}")
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    context.startActivity(intent)
                } catch (e: Exception) {
                    val intent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    context.startActivity(intent)
                }
            }
        }

        @JavascriptInterface
        fun checkPermissions(): String {
            val packages = NotificationManagerCompat.getEnabledListenerPackages(context)
            val isListenerGranted = packages.contains(context.packageName)

            var isBatteryIgnoring = false
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
                isBatteryIgnoring = pm.isIgnoringBatteryOptimizations(context.packageName)
            }

            val json = JSONObject().apply {
                put("notificationListener", isListenerGranted)
                put("batteryIgnoring", isBatteryIgnoring)
            }
            return json.toString()
        }

        @JavascriptInterface
        fun savePairConfig(pairCode: String, role: String) {
            val sp = context.getSharedPreferences("link_notify_config", Context.MODE_PRIVATE)
            sp.edit()
                .putString("pair_code", pairCode)
                .putString("role", role)
                .apply()
        }

        @JavascriptInterface
        fun getPairConfig(): String {
            val sp = context.getSharedPreferences("link_notify_config", Context.MODE_PRIVATE)
            val json = JSONObject().apply {
                put("pairCode", sp.getString("pair_code", ""))
                put("role", sp.getString("role", ""))
            }
            return json.toString()
        }

        @JavascriptInterface
        fun vibrate() {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    val vm = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
                    vm.defaultVibrator.vibrate(VibrationEffect.createOneShot(50, VibrationEffect.DEFAULT_AMPLITUDE))
                } else {
                    @Suppress("DEPRECATION")
                    val v = context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        v.vibrate(VibrationEffect.createOneShot(50, VibrationEffect.DEFAULT_AMPLITUDE))
                    } else {
                        @Suppress("DEPRECATION")
                        v.vibrate(50)
                    }
                }
            } catch (ignored: Exception) {}
        }

        @JavascriptInterface
        fun getBatteryInfo(): String {
            val ifilter = IntentFilter(Intent.ACTION_BATTERY_CHANGED)
            val batteryStatus: Intent? = context.registerReceiver(null, ifilter)
            val level: Int = batteryStatus?.getIntExtra(android.os.BatteryManager.EXTRA_LEVEL, -1) ?: -1
            val scale: Int = batteryStatus?.getIntExtra(android.os.BatteryManager.EXTRA_SCALE, -1) ?: -1
            val batteryPct: Int = if (level >= 0 && scale > 0) (level * 100 / scale.toFloat()).toInt() else 100
            val status: Int = batteryStatus?.getIntExtra(android.os.BatteryManager.EXTRA_STATUS, -1) ?: -1
            val isCharging: Boolean = status == android.os.BatteryManager.BATTERY_STATUS_CHARGING ||
                    status == android.os.BatteryManager.BATTERY_STATUS_FULL
            val json = JSONObject().apply {
                put("percent", batteryPct)
                put("isCharging", isCharging)
            }
            return json.toString()
        }

        @JavascriptInterface
        fun getSignalInfo(): String {
            var dbm = -65
            try {
                val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? android.net.wifi.WifiManager
                val wifiInfo = wifiManager?.connectionInfo
                if (wifiInfo != null && wifiInfo.rssi != -127 && wifiInfo.rssi < 0) {
                    dbm = wifiInfo.rssi
                }
            } catch (ignored: Exception) {}
            val json = JSONObject().apply {
                put("dbm", dbm)
            }
            return json.toString()
        }

        private fun getSystemProperty(key: String): String {
            return try {
                val clz = Class.forName("android.os.SystemProperties")
                val getMethod = clz.getMethod("get", String::class.java, String::class.java)
                (getMethod.invoke(null, key, "") as? String)?.trim() ?: ""
            } catch (e: Exception) {
                ""
            }
        }

        private fun resolveDeviceFriendlyName(model: String, brand: String, manufacturer: String, systemDeviceName: String): String {
            // 1. 优先读取系统底层由手机厂商直接固化在 ROM 中的商业机型属性
            val propertyKeys = listOf(
                "ro.product.marketname",        // 通用市场机型名 (vivo, 小米, oppo, 荣耀等出厂写入)
                "ro.vivo.market.name",         // vivo / iQOO 原厂市场名 (例如 vivo S18 Pro, vivo X100 等)
                "ro.oppo.market.name",         // OPPO / 一加 原厂市场名
                "ro.config.marketing_name",    // 华为 / 荣耀 原厂市场名
                "ro.product.model.marketname",
                "ro.product.market_name",
                "ro.vendor.marketname",
                "ro.vendor.oppo.market.name"
            )
            for (key in propertyKeys) {
                val prop = getSystemProperty(key)
                if (prop.isNotBlank()) {
                    return prop
                }
            }

            // 2. 检查系统全局或蓝牙设置名 (用户或出厂设置)
            if (systemDeviceName.isNotBlank() && 
                !systemDeviceName.equals("Android", ignoreCase = true) && 
                !systemDeviceName.equals(model, ignoreCase = true)) {
                return systemDeviceName
            }

            // 3. 常见机型代码对照表 (兜底容错)
            val upperModel = model.uppercase().trim()
            val modelMap = mapOf(
                // Vivo
                "V2344A" to "Vivo S18pro",
                "V2344DA" to "Vivo S18pro",
                "V2323A" to "Vivo S18",
                "V2329A" to "Vivo S18e",
                "V2362A" to "Vivo S19",
                "V2364A" to "Vivo S19 Pro",
                "V2309A" to "Vivo X100 Pro",
                "V2324A" to "Vivo X100",
                "V2324HA" to "Vivo X100s",
                "V2359A" to "Vivo X100 Ultra",
                "V2405A" to "Vivo X200",
                "V2415A" to "Vivo X200 Pro",
                "V2419A" to "Vivo X200 Pro mini",
                "V2338A" to "iQOO 12",
                // Xiaomi
                "23127PN0CC" to "Xiaomi 14",
                "23116PN5BC" to "Xiaomi 14 Pro",
                "24031PN0DC" to "Xiaomi 14 Ultra",
                "24129PN74C" to "Xiaomi 15",
                "24101PNABC" to "Xiaomi 15 Pro",
                "2210132C" to "Xiaomi 13 Pro",
                "2211133C" to "Xiaomi 13",
                "2311DRK48C" to "Redmi K70",
                "23113RKC6C" to "Redmi K70 Pro",
                "24117RK2CC" to "Redmi K80",
                "24122RKC7C" to "Redmi K80 Pro",
                // Huawei & Honor
                "ALN-AL00" to "HUAWEI Mate 60 Pro",
                "ALN-AL80" to "HUAWEI Mate 60 Pro",
                "BRA-AL00" to "HUAWEI Mate 60",
                "HBP-AL00" to "HUAWEI Pura 70",
                "HBN-AL00" to "HUAWEI Pura 70 Pro",
                "BVY-AN00" to "HONOR Magic6 Pro",
                // OPPO & OnePlus
                "PHY110" to "OPPO Find X7",
                "PHZ110" to "OPPO Find X7 Ultra",
                "PKB110" to "OPPO Find X8",
                "PJD110" to "OnePlus 12",
                "PJJ110" to "OnePlus Ace 3",
                // Samsung
                "SM-S9280" to "Galaxy S24 Ultra",
                "SM-S9210" to "Galaxy S24",
                "SM-S9180" to "Galaxy S23 Ultra"
            )

            modelMap[upperModel]?.let { return it }

            val prettyBrand = brand.replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }
            return if (model.isNotBlank()) {
                if (model.startsWith(prettyBrand, ignoreCase = true)) model else "$prettyBrand $model"
            } else {
                prettyBrand.ifBlank { "Android Device" }
            }
        }

        @JavascriptInterface
        fun getDeviceInfo(): String {
            var deviceName = ""
            try {
                deviceName = android.provider.Settings.Global.getString(context.contentResolver, "device_name") ?: ""
            } catch (ignored: Exception) {}

            if (deviceName.isBlank()) {
                try {
                    deviceName = android.provider.Settings.Secure.getString(context.contentResolver, "bluetooth_name") ?: ""
                } catch (ignored: Exception) {}
            }

            val model = Build.MODEL ?: ""
            val brand = Build.BRAND ?: ""
            val manufacturer = Build.MANUFACTURER ?: ""
            val friendly = resolveDeviceFriendlyName(model, brand, manufacturer, deviceName)

            val json = JSONObject().apply {
                put("model", model)
                put("brand", brand)
                put("manufacturer", manufacturer)
                put("deviceName", deviceName)
                put("friendlyName", friendly)
            }
            return json.toString()
        }

        @JavascriptInterface
        fun showToast(msg: String) {
            runOnUiThread {
                Toast.makeText(context, msg, Toast.LENGTH_SHORT).show()
            }
        }
    }
}
