package io.github.quickhardsub

import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.net.Uri
import android.os.Bundle
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.webkit.WebViewAssetLoader

class MainActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private lateinit var nativeBridge: NativeBridge
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingPickerRole: String? = null
    private var pendingExportJobId: String? = null
    private var pendingSampleExportId: String? = null
    private val filePickerRequest = 1401
    private val exportRequest = 1402
    private val sampleExportRequest = 1403

    private val assetLoader by lazy {
        WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)
        setContentView(webView)

        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.allowFileAccess = false
        webView.settings.allowContentAccess = true
        webView.settings.mediaPlaybackRequiresUserGesture = true

        val debuggable = (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        WebView.setWebContentsDebuggingEnabled(debuggable)
        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView?,
                request: WebResourceRequest?
            ): WebResourceResponse? {
                return request?.url?.let(assetLoader::shouldInterceptRequest)
            }

            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: WebResourceRequest?
            ): Boolean {
                val uri = request?.url ?: return true
                return uri.host != "appassets.androidplatform.net"
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView?,
                callback: ValueCallback<Array<Uri>>?,
                params: FileChooserParams?
            ): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                pendingPickerRole = nativeBridge.consumePickerRole()

                val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "*/*"
                    putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params?.mode == FileChooserParams.MODE_OPEN_MULTIPLE)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
                }
                startActivityForResult(intent, filePickerRequest)
                return true
            }
        }

        nativeBridge = NativeBridge(this, webView)
        webView.addJavascriptInterface(nativeBridge, "NativeHardsub")
        webView.loadUrl("https://appassets.androidplatform.net/assets/www/index.html")

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })
    }

    fun requestNativeExport(jobId: String, suggestedName: String) {
        if (!NativeJobStore.isSafeJobId(jobId)) return
        val output = NativeJobStore.outputFile(this, jobId)
        if (!output.isFile || output.length() <= 0L) return

        pendingExportJobId = jobId
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "video/x-matroska"
            putExtra(Intent.EXTRA_TITLE, suggestedName)
            addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        }

        try {
            startActivityForResult(intent, exportRequest)
        } catch (_: Throwable) {
            pendingExportJobId = null
        }
    }

    fun requestNativeSampleExport(sampleId: String, suggestedName: String) {
        if (!NativeSampleStore.isSafeId(sampleId)) return
        val sample = NativeSampleStore.file(this, sampleId)
        if (!sample.isFile || sample.length() <= 0L) return

        pendingSampleExportId = sampleId
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "video/x-matroska"
            putExtra(Intent.EXTRA_TITLE, suggestedName)
            addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        }

        try {
            startActivityForResult(intent, sampleExportRequest)
        } catch (_: Throwable) {
            pendingSampleExportId = null
        }
    }

    private fun persistUriPermission(uri: Uri, flags: Int) {
        val takeFlags = flags and (
            Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        )
        if (takeFlags == 0) return
        try {
            contentResolver.takePersistableUriPermission(uri, takeFlags)
        } catch (_: SecurityException) {
            // Some providers grant access only for the current activity/process.
            // The file remains usable for the current run.
        }
    }

    @Deprecated("Deprecated in Android API; retained for WebView file chooser compatibility.")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == sampleExportRequest) {
            val sampleId = pendingSampleExportId
            pendingSampleExportId = null

            if (resultCode == RESULT_OK && sampleId != null) {
                val uri = data?.data
                if (uri != null) {
                    val flags = data.flags
                    persistUriPermission(uri, flags)
                    nativeBridge.exportNativeSample(sampleId, uri)
                }
            }
            return
        }

        if (requestCode == exportRequest) {
            val jobId = pendingExportJobId
            pendingExportJobId = null

            if (resultCode == RESULT_OK && jobId != null) {
                val uri = data?.data
                if (uri != null) {
                    val flags = data.flags
                    persistUriPermission(uri, flags)
                    nativeBridge.exportJobOutput(jobId, uri)
                }
            }
            return
        }

        if (requestCode == filePickerRequest) {
            val result = if (resultCode == RESULT_OK) {
                val flags = data?.flags ?: 0
                val uris = mutableListOf<Uri>()

                data?.data?.let { uri ->
                    persistUriPermission(uri, flags)
                    uris.add(uri)
                }
                data?.clipData?.let { clip ->
                    for (i in 0 until clip.itemCount) {
                        val uri = clip.getItemAt(i).uri
                        persistUriPermission(uri, flags)
                        uris.add(uri)
                    }
                }

                nativeBridge.recordPickedUris(pendingPickerRole, uris.distinct())
                WebChromeClient.FileChooserParams.parseResult(resultCode, data)
            } else {
                nativeBridge.recordPickedUris(pendingPickerRole, emptyList())
                null
            }

            pendingPickerRole = null
            fileCallback?.onReceiveValue(result)
            fileCallback = null
            return
        }
        super.onActivityResult(requestCode, resultCode, data)
    }
}
