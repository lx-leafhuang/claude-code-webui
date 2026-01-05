package com.claudecode.webui

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.webkit.CookieManager
import android.webkit.SslErrorHandler
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.net.http.SslError
import android.widget.Toast
import androidx.activity.addCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.isVisible
import com.claudecode.webui.BuildConfig
import com.claudecode.webui.databinding.ActivityWebviewBinding

class WebViewActivity : AppCompatActivity() {

    private lateinit var binding: ActivityWebviewBinding
    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val data = WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
        filePathCallback?.onReceiveValue(data)
        filePathCallback = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityWebviewBinding.inflate(layoutInflater)
        setContentView(binding.root)

        val baseUrl = intent.getStringExtra(EXTRA_BASE_URL)
        if (baseUrl.isNullOrBlank()) {
            Toast.makeText(this, R.string.connection_error, Toast.LENGTH_SHORT).show()
            finish()
            return
        }

        setSupportActionBar(binding.toolbar)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        binding.toolbar.title = getString(R.string.app_name)
        binding.toolbar.subtitle = intent.getStringExtra(EXTRA_HOST) ?: baseUrl
        binding.toolbar.setNavigationOnClickListener { onBackPressedDispatcher.onBackPressed() }

        initWebView()
        binding.swipeRefresh.isEnabled = false
        binding.webView.loadUrl(baseUrl)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun initWebView() {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

        with(binding.webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowContentAccess = true
            allowFileAccess = true
            setSupportZoom(true)
            builtInZoomControls = true
            displayZoomControls = false
            useWideViewPort = true
            loadWithOverviewMode = true
            layoutAlgorithm = WebSettings.LayoutAlgorithm.TEXT_AUTOSIZING
            cacheMode = WebSettings.LOAD_DEFAULT
            mediaPlaybackRequiresUserGesture = false
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        }

        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(binding.webView, true)
        }

        binding.webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
                binding.swipeRefresh.isRefreshing = true
                binding.progressBar.isVisible = true
            }

            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: WebResourceRequest?
            ): Boolean {
                val uri = request?.url ?: return false
                val scheme = uri.scheme ?: return false
                return if (scheme == "http" || scheme == "https") {
                    false
                } else {
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, uri))
                    } catch (_: Exception) {
                        Toast.makeText(this@WebViewActivity, R.string.connection_error, Toast.LENGTH_SHORT).show()
                    }
                    true
                }
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                binding.swipeRefresh.isRefreshing = false
                binding.progressBar.isVisible = false
            }

            override fun onReceivedSslError(
                view: WebView?,
                handler: SslErrorHandler?,
                error: SslError?
            ) {
                // 允许自签名/开发环境证书，确保 HTTPS 可访问；如需严格校验证书，可改为 handler?.cancel()
                Toast.makeText(this@WebViewActivity, R.string.ssl_warning, Toast.LENGTH_SHORT).show()
                handler?.proceed()
            }
        }

        binding.webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                super.onProgressChanged(view, newProgress)
                binding.progressBar.isVisible = newProgress in 1..99
                binding.progressBar.progress = newProgress
            }

            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: WebChromeClient.FileChooserParams?
            ): Boolean {
                this@WebViewActivity.filePathCallback?.onReceiveValue(null)
                this@WebViewActivity.filePathCallback = filePathCallback
                return try {
                    val intent = fileChooserParams?.createIntent() ?: return false
                    fileChooserLauncher.launch(intent)
                    true
                } catch (e: ActivityNotFoundException) {
                    this@WebViewActivity.filePathCallback = null
                    Toast.makeText(this@WebViewActivity, R.string.connection_error, Toast.LENGTH_SHORT).show()
                    false
                }
            }
        }

        binding.webView.isHorizontalScrollBarEnabled = false
        binding.webView.overScrollMode = View.OVER_SCROLL_NEVER

        onBackPressedDispatcher.addCallback(this) {
            if (binding.webView.canGoBack()) {
                binding.webView.goBack()
            } else {
                finish()
            }
        }
    }

    override fun onPause() {
        binding.webView.onPause()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        binding.webView.onResume()
    }

    override fun onDestroy() {
        filePathCallback?.onReceiveValue(null)
        binding.webView.apply {
            loadUrl("about:blank")
            stopLoading()
            destroy()
        }
        super.onDestroy()
    }

    companion object {
        const val EXTRA_BASE_URL = "base_url"
        const val EXTRA_HOST = "base_host"
    }
}
