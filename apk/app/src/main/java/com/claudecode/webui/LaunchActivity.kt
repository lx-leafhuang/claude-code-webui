package com.claudecode.webui

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.inputmethod.EditorInfo
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.claudecode.webui.databinding.ActivityLaunchBinding

class LaunchActivity : AppCompatActivity() {

    private lateinit var binding: ActivityLaunchBinding

    private val prefs by lazy {
        getSharedPreferences("connection", MODE_PRIVATE)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityLaunchBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setSupportActionBar(binding.toolbar)
        supportActionBar?.title = getString(R.string.app_name)

        preloadSavedValues()
        binding.connectButton.setOnClickListener { connect() }
        binding.inputPort.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_GO || actionId == EditorInfo.IME_ACTION_DONE) {
                connect()
                true
            } else {
                false
            }
        }
    }

    private fun preloadSavedValues() {
        val savedHost = prefs.getString(KEY_HOST, "127.0.0.1")
        val savedPort = prefs.getString(KEY_PORT, "8080")
        val savedHttps = prefs.getBoolean(KEY_HTTPS, false)
        binding.inputHost.setText(savedHost)
        binding.inputPort.setText(savedPort)
        binding.switchHttps.isChecked = savedHttps
    }

    private fun connect() {
        val hostRaw = binding.inputHost.text?.toString()?.trim().orEmpty()
        val portRaw = binding.inputPort.text?.toString()?.trim().orEmpty()
        val useHttps = binding.switchHttps.isChecked

        if (hostRaw.isBlank()) {
            binding.hostInputLayout.error = getString(R.string.connection_error)
            return
        } else {
            binding.hostInputLayout.error = null
        }

        if (portRaw.isNotBlank() && portRaw.toIntOrNull() == null) {
            binding.portInputLayout.error = getString(R.string.port_error)
            return
        } else {
            binding.portInputLayout.error = null
        }

        val connection = buildUrl(hostRaw, portRaw, useHttps)
        if (connection == null) {
            binding.hostInputLayout.error = getString(R.string.connection_error)
            Toast.makeText(this, getString(R.string.connection_error), Toast.LENGTH_SHORT).show()
            return
        } else {
            binding.hostInputLayout.error = null
            binding.portInputLayout.error = null
        }

        prefs.edit()
            .putString(KEY_HOST, hostRaw)
            .putString(KEY_PORT, connection.port.toString())
            .putBoolean(KEY_HTTPS, connection.scheme == "https")
            .apply()

        startActivity(
            Intent(this, WebViewActivity::class.java).apply {
                putExtra(WebViewActivity.EXTRA_BASE_URL, connection.url)
                putExtra(WebViewActivity.EXTRA_HOST, connection.host)
            }
        )
    }

    private fun buildUrl(hostRaw: String, portRaw: String, useHttps: Boolean): ConnectionInfo? {
        if (hostRaw.isBlank()) return null
        val defaultPort = 8080
        val fallbackScheme = if (useHttps) "https" else "http"
        val parsed = Uri.parse(if (hostRaw.contains("://")) hostRaw else "$fallbackScheme://$hostRaw")
        val host = parsed.host ?: return null
        val authorityHost = if (host.contains(":")) "[${host.trim('[', ']')}]" else host
        val port = when {
            parsed.port != -1 -> parsed.port
            portRaw.toIntOrNull() != null -> portRaw.toInt()
            else -> defaultPort
        }
        val scheme = parsed.scheme ?: fallbackScheme
        if (port !in 1..65535) return null
        val path = parsed.encodedPath?.takeIf { it.isNotBlank() } ?: ""
        return ConnectionInfo(
            url = Uri.Builder()
                .scheme(scheme)
                .encodedAuthority("$authorityHost:$port")
                .encodedPath(path)
                .encodedQuery(parsed.encodedQuery)
                .build()
                .toString(),
            host = host,
            port = port,
            scheme = scheme
        )
    }

    data class ConnectionInfo(val url: String, val host: String, val port: Int, val scheme: String)

    companion object {
        private const val KEY_HOST = "host"
        private const val KEY_PORT = "port"
        private const val KEY_HTTPS = "https"
    }
}
