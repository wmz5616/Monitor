package com.linknotify.companion

import android.content.Context
import android.util.Log
import org.eclipse.paho.client.mqttv3.MqttClient
import org.eclipse.paho.client.mqttv3.MqttConnectOptions
import org.eclipse.paho.client.mqttv3.MqttMessage
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence
import java.security.MessageDigest
import kotlin.concurrent.thread

object MqttDispatcher {
    private const val TAG = "MqttDispatcher"
    private const val BROKER_URL = "tcp://broker.emqx.io:1883"
    private var client: MqttClient? = null

    /**
     * 跨网推送到公开中继通道 (基于 6 位配对码的 SHA-256 专属信道)
     */
    fun dispatch(context: Context, pairCode: String, payloadJson: String) {
        if (pairCode.length < 6) {
            Log.w(TAG, "未配置有效的 6 位配对码，跳过转发")
            return
        }

        thread {
            try {
                val channelHash = sha256Hex(pairCode).substring(0, 16)
                val topic = "linknotify/v1/$channelHash"

                synchronized(this) {
                    if (client == null || !client!!.isConnected) {
                        val clientId = "ln_b_kt_" + System.currentTimeMillis().toString().takeLast(6)
                        client = MqttClient(BROKER_URL, clientId, MemoryPersistence())
                        val opts = MqttConnectOptions().apply {
                            isCleanSession = true
                            connectionTimeout = 5
                            keepAliveInterval = 30
                        }
                        client!!.connect(opts)
                    }
                }

                val msg = MqttMessage(payloadJson.toByteArray(Charsets.UTF_8)).apply {
                    qos = 1
                }
                client?.publish(topic, msg)
                Log.i(TAG, "成功向信道 $topic 广播通知")
            } catch (e: Exception) {
                Log.e(TAG, "MQTT 广播失败: ${e.message}")
                synchronized(this) {
                    try { client?.disconnect() } catch (ignored: Exception) {}
                    client = null
                }
            }
        }
    }

    private fun sha256Hex(input: String): String {
        val bytes = MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.UTF_8))
        return bytes.joinToString("") { "%02x".format(it) }
    }
}
