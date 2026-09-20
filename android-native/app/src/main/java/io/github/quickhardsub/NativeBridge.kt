package io.github.quickhardsub

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.os.storage.StorageManager
import android.system.Os
import android.system.OsConstants
import android.webkit.JavascriptInterface
import android.util.Base64
import android.webkit.WebView
import com.arthenica.ffmpegkit.FFmpegKit
import com.arthenica.ffmpegkit.FFmpegKitConfig
import com.arthenica.ffmpegkit.FFprobeKit
import com.arthenica.ffmpegkit.ReturnCode
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.UUID
import kotlin.concurrent.thread

class NativeBridge(
    private val activity: Activity,
    private val webView: WebView
) {
    companion object {
        private const val UPDATE_MANIFEST_URL =
            "https://11576865.github.io/Quick-Automatic-Hardsub-Encoder/app-update.json"
        private const val UPDATE_DOWNLOAD_HOST = "11576865.github.io"
        private const val UPDATE_DOWNLOAD_PATH_PREFIX =
            "/Quick-Automatic-Hardsub-Encoder/downloads/"
    }
    @Volatile
    private var nextPickerRole: String? = null

    private val pickedUris = mutableMapOf<String, List<Uri>>()
    private val pickerLock = Any()

    @JavascriptInterface
    fun preparePickerRole(role: String) {
        nextPickerRole = when (role) {
            "video", "ass", "fonts" -> role
            else -> null
        }
    }

    fun consumePickerRole(): String? {
        val role = nextPickerRole
        nextPickerRole = null
        return role
    }

    fun recordPickedUris(role: String?, uris: List<Uri>) {
        if (role == null) return
        synchronized(pickerLock) {
            if (uris.isEmpty()) pickedUris.remove(role)
            else pickedUris[role] = uris.toList()
        }
    }

    fun getPickedUris(role: String): List<Uri> =
        synchronized(pickerLock) { pickedUris[role]?.toList() ?: emptyList() }

    @JavascriptInterface
    fun getNativeSelectionState(): String {
        val snapshot = synchronized(pickerLock) {
            mapOf(
                "video" to (pickedUris["video"]?.size ?: 0),
                "ass" to (pickedUris["ass"]?.size ?: 0),
                "fonts" to (pickedUris["fonts"]?.size ?: 0)
            )
        }

        return JSONObject()
            .put("video", snapshot["video"])
            .put("ass", snapshot["ass"])
            .put("fonts", snapshot["fonts"])
            .toString()
    }
    @JavascriptInterface
    fun probeSelectedVideo() {
        thread(name = "native-input-probe") {
            val result = JSONObject()
            val uri = getPickedUris("video").firstOrNull()

            if (uri == null) {
                result.put("ok", false)
                result.put("error", "没有可供原生后端访问的视频 URI")
                postJsonCallback("__onNativeInputProbe", result)
                return@thread
            }

            var safUrl: String? = null
            try {
                var statSize = -1L
                var seekable = false
                activity.contentResolver.openFileDescriptor(uri, "r")?.use { pfd ->
                    statSize = pfd.statSize
                    seekable = try {
                        Os.lseek(pfd.fileDescriptor, 0L, OsConstants.SEEK_CUR)
                        true
                    } catch (_: Throwable) {
                        false
                    }
                }

                safUrl = FFmpegKitConfig.getSafParameterForRead(activity, uri, true)
                if (safUrl.isNullOrBlank()) throw IllegalStateException("无法创建 FFmpegKit SAF 读取 URL")

                val probe = FFprobeKit.getMediaInformation(safUrl)
                val info = probe.getMediaInformation()
                    ?: throw IllegalStateException(probe.getOutput().takeLast(1200).ifBlank { "FFprobe 无法读取该 URI" })

                val streams = info.getStreams()
                val video = streams.firstOrNull { it.getType() == "video" }
                    ?: throw IllegalStateException("FFprobe 没有发现视频流")
                val audioStreams = streams.filter { it.getType() == "audio" }
                val audioTracks = audioStreams.size
                val props = video.getAllProperties()
                val pixelFormat = video.getFormat() ?: ""
                val explicitDepth = props?.optString("bits_per_raw_sample", "")?.toIntOrNull() ?: 0
                val inferredDepth = if (explicitDepth > 0) explicitDepth else {
                    Regex("(10|12|14|16)(?:le|be)?", RegexOption.IGNORE_CASE)
                        .find(pixelFormat)
                        ?.groupValues
                        ?.getOrNull(1)
                        ?.toIntOrNull()
                        ?: 8
                }
                val colorTransfer = props?.optString("color_transfer", "") ?: ""
                val colorPrimaries = props?.optString("color_primaries", "") ?: ""
                val colorSpace = props?.optString("color_space", "") ?: ""
                val hdr = colorTransfer.contains("smpte2084", true) ||
                    colorTransfer.contains("arib-std-b67", true) ||
                    (colorPrimaries.contains("bt2020", true) && inferredDepth > 8)
                val audioBitRate = audioStreams.sumOf { stream ->
                    stream.getBitrate()?.toLongOrNull() ?: 0L
                }

                val decodeSmoke = FFmpegKit.executeWithArguments(
                    arrayOf(
                        "-hide_banner",
                        "-v", "error",
                        "-i", safUrl,
                        "-map", "0:v:0",
                        "-frames:v", "1",
                        "-f", "null",
                        "-"
                    )
                )
                val inputDecodeSmoke = ReturnCode.isSuccess(decodeSmoke.getReturnCode())

                result
                    .put("ok", true)
                    .put("inputDecodeSmoke", inputDecodeSmoke)
                    .put("inputDecodeError", if (inputDecodeSmoke) "" else decodeSmoke.getOutput().takeLast(1200))
                    .put("seekable", seekable)
                    .put("statSize", statSize)
                    .put("needsInputStaging", !seekable)
                    .put("format", info.getFormat() ?: "")
                    .put("duration", info.getDuration()?.toDoubleOrNull() ?: 0.0)
                    .put("bitRate", info.getBitrate()?.toLongOrNull() ?: 0L)
                    .put("videoCodec", video.getCodec() ?: "")
                    .put("videoBitRate", video.getBitrate()?.toLongOrNull() ?: 0L)
                    .put("width", video.getWidth() ?: 0)
                    .put("height", video.getHeight() ?: 0)
                    .put("fps", video.getAverageFrameRate() ?: "")
                    .put("pixelFormat", pixelFormat)
                    .put("bitDepth", inferredDepth)
                    .put("colorTransfer", colorTransfer)
                    .put("colorPrimaries", colorPrimaries)
                    .put("colorSpace", colorSpace)
                    .put("hdr", hdr)
                    .put("unsafeColorPipeline", hdr || inferredDepth > 8)
                    .put("audioTracks", audioTracks)
                    .put("audioCodec", audioStreams.firstOrNull()?.getCodec() ?: "")
                    .put("audioBitRate", audioBitRate)
            } catch (e: Throwable) {
                result.put("ok", false)
                result.put("error", e.message ?: e.javaClass.simpleName)
            } finally {
                if (!safUrl.isNullOrBlank()) {
                    try { FFmpegKitConfig.unregisterSafProtocolUrl(safUrl) } catch (_: Throwable) {}
                }
                try { FFmpegKitConfig.clearSessions() } catch (_: Throwable) {}
            }

            postJsonCallback("__onNativeInputProbe", result)
        }
    }

    private fun postJsonCallback(callbackName: String, result: JSONObject) {
        val quoted = JSONObject.quote(result.toString())
        activity.runOnUiThread {
            webView.evaluateJavascript(
                "window.$callbackName && window.$callbackName($quoted);",
                null
            )
        }
    }

    private fun getStagingAllocatableBytes(): Long {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val storage = activity.getSystemService(StorageManager::class.java)
                val uuid = storage.getUuidForPath(activity.filesDir)
                storage.getAllocatableBytes(uuid)
            } else {
                activity.filesDir.usableSpace
            }
        } catch (_: Throwable) {
            activity.filesDir.usableSpace
        }
    }

    private fun getThermalStatus(): Int? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return null
        return try {
            activity.getSystemService(PowerManager::class.java).currentThermalStatus
        } catch (_: Throwable) {
            null
        }
    }

    @Suppress("DEPRECATION")
    private fun getCurrentSignerSha256(): String? {
        return try {
            val packageInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                activity.packageManager.getPackageInfo(
                    activity.packageName,
                    PackageManager.GET_SIGNING_CERTIFICATES
                )
            } else {
                activity.packageManager.getPackageInfo(
                    activity.packageName,
                    PackageManager.GET_SIGNATURES
                )
            }

            val signature = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                packageInfo.signingInfo?.apkContentsSigners?.firstOrNull()
            } else {
                packageInfo.signatures?.firstOrNull()
            } ?: return null

            MessageDigest.getInstance("SHA-256")
                .digest(signature.toByteArray())
                .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
        } catch (_: Throwable) {
            null
        }
    }

    @JavascriptInterface
    fun getBackendInfo(): String {
        val power = activity.getSystemService(PowerManager::class.java)
        return JSONObject()
            .put("available", true)
            .put("backend", "android-native")
            .put("abi", Build.SUPPORTED_ABIS.firstOrNull() ?: "unknown")
            .put("apiLevel", Build.VERSION.SDK_INT)
            .put("appVersionCode", BuildConfig.VERSION_CODE)
            .put("appVersionName", BuildConfig.VERSION_NAME)
            .put("signerSha256", getCurrentSignerSha256() ?: "")
            .put("ffmpegKitVersion", FFmpegKitConfig.getVersion())
            .put("mediaCodecBuiltIn", true)
            .put("mediaCodecEncodingDefault", false)
            .put("stagingAllocatableBytes", getStagingAllocatableBytes())
            .put("thermalStatus", getThermalStatus())
            .put("powerSaveMode", power.isPowerSaveMode)
            .put("sustainedPerformanceSupported", power.isSustainedPerformanceModeSupported)
            .toString()
    }

    @JavascriptInterface
    fun checkForUpdate() {
        thread(name = "native-update-check") {
            val result = JSONObject()
            var connection: HttpURLConnection? = null
            try {
                val manifestUrl = UPDATE_MANIFEST_URL + "?t=" + System.currentTimeMillis()
                connection = (URL(manifestUrl).openConnection() as HttpURLConnection).apply {
                    connectTimeout = 8000
                    readTimeout = 8000
                    useCaches = false
                    requestMethod = "GET"
                    setRequestProperty("Accept", "application/json")
                    setRequestProperty("Cache-Control", "no-cache")
                    setRequestProperty("User-Agent", "QuickHardsub/${BuildConfig.VERSION_NAME} Android")
                }

                val status = connection.responseCode
                if (status !in 200..299) {
                    throw IllegalStateException("更新清单 HTTP $status")
                }

                val manifest = connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
                val latest = JSONObject(manifest)
                val latestCode = latest.optLong("versionCode", -1L)
                val latestPackage = latest.optString("packageName", "")
                val apkUrl = latest.optString("apkUrl", "")
                val apkUri = Uri.parse(apkUrl)
                val sha256 = latest.optString("sha256", "").trim().lowercase()
                val signerSha256 = latest.optString("signerSha256", "").trim().lowercase()
                val installedSignerSha256 = getCurrentSignerSha256()?.lowercase()

                if (latestCode < 1 || latestCode > Int.MAX_VALUE) {
                    throw IllegalStateException("更新清单 versionCode 无效")
                }
                if (latestPackage != activity.packageName) {
                    throw IllegalStateException("更新清单包名不匹配")
                }
                if (
                    !apkUri.scheme.equals("https", ignoreCase = true) ||
                    !apkUri.host.equals(UPDATE_DOWNLOAD_HOST, ignoreCase = true) ||
                    !apkUri.path.orEmpty().startsWith(UPDATE_DOWNLOAD_PATH_PREFIX) ||
                    !apkUri.path.orEmpty().endsWith(".apk", ignoreCase = true)
                ) {
                    throw IllegalStateException("更新清单 APK 地址不在受信任下载路径")
                }
                if (!Regex("^[0-9a-f]{64}$").matches(sha256)) {
                    throw IllegalStateException("更新清单缺少有效 APK SHA-256")
                }
                if (!Regex("^[0-9a-f]{64}$").matches(signerSha256)) {
                    throw IllegalStateException("更新清单缺少有效签名摘要")
                }
                if (installedSignerSha256 == null) {
                    throw IllegalStateException("无法读取当前应用签名，已拒绝更新")
                }
                if (signerSha256 != installedSignerSha256) {
                    throw IllegalStateException("更新包签名与当前应用签名不一致，已拒绝自动引导更新")
                }

                result
                    .put("ok", true)
                    .put("manifestUrl", UPDATE_MANIFEST_URL)
                    .put("installedVersionCode", BuildConfig.VERSION_CODE)
                    .put("installedVersionName", BuildConfig.VERSION_NAME)
                    .put("installedSignerSha256", installedSignerSha256 ?: "")
                    .put("latestVersionCode", latestCode)
                    .put("latestVersionName", latest.optString("versionName", ""))
                    .put("updateAvailable", latestCode > BuildConfig.VERSION_CODE)
                    .put("apkUrl", apkUrl)
                    .put("sha256", sha256)
                    .put("signerSha256", signerSha256)
                    .put("publishedAt", latest.optString("publishedAt", ""))
                    .put("notes", latest.optJSONArray("notes"))
            } catch (e: Throwable) {
                result
                    .put("ok", false)
                    .put("installedVersionCode", BuildConfig.VERSION_CODE)
                    .put("installedVersionName", BuildConfig.VERSION_NAME)
                    .put("error", e.message ?: e.javaClass.simpleName)
            } finally {
                try { connection?.disconnect() } catch (_: Throwable) {}
            }

            postJsonCallback("__onNativeUpdateCheck", result)
        }
    }

    @JavascriptInterface
    fun renderNativePreview(requestId: String, timeSeconds: Double, assText: String) {
        thread(name = "native-preview") {
            val result = JSONObject().put("requestId", requestId)
            var safUrl: String? = null
            val previewRoot = File(activity.cacheDir, "native-preview")
            try {
                if (assText.isBlank()) throw IllegalStateException("ASS 字幕为空")
                if (!timeSeconds.isFinite() || timeSeconds < 0.0) {
                    throw IllegalStateException("预览时间无效")
                }
                val inputUri = getPickedUris("video").firstOrNull()
                    ?: throw IllegalStateException("没有可供 Native 预览使用的视频 URI")

                if (previewRoot.exists()) previewRoot.deleteRecursively()
                previewRoot.mkdirs()
                val fontsDir = File(previewRoot, "fonts")
                fontsDir.mkdirs()
                getPickedUris("fonts").forEachIndexed { index, uri ->
                    val name = NativeJobStore.displayName(activity, uri, "font_" + index + ".ttf")
                    NativeJobStore.copyUriToFile(
                        activity,
                        uri,
                        File(fontsDir, index.toString().padStart(3, '0') + "_" + name)
                    )
                }
                NativeJobStore.configureFonts(
                    activity,
                    if (fontsDir.listFiles()?.isNotEmpty() == true) listOf(fontsDir.absolutePath) else emptyList()
                )

                val assFile = File(previewRoot, "preview.ass")
                assFile.writeText(assText, Charsets.UTF_8)
                val subPng = File(previewRoot, "sub.png")
                val basePng = File(previewRoot, "base.png")

                safUrl = FFmpegKitConfig.getSafParameterForRead(activity, inputUri, true)
                if (safUrl.isNullOrBlank()) throw IllegalStateException("无法创建 Native 预览 SAF URL")

                val common = arrayOf(
                    "-y",
                    "-hide_banner",
                    "-v", "error",
                    "-ss", String.format(java.util.Locale.US, "%.3f", timeSeconds),
                    "-i", safUrl,
                    "-map", "0:v:0",
                    "-frames:v", "1"
                )
                val scale = "scale=1280:-2:force_original_aspect_ratio=decrease"
                val base = common + arrayOf(
                    "-vf", scale,
                    "-c:v", "png",
                    basePng.absolutePath
                )
                val assFilter =
                    "ass=" + NativeJobStore.escapeFilterPath(assFile.absolutePath) +
                    ":fontsdir=" + NativeJobStore.escapeFilterPath(fontsDir.absolutePath) +
                    "," + scale
                val sub = common + arrayOf(
                    "-vf", assFilter,
                    "-c:v", "png",
                    subPng.absolutePath
                )

                val baseSession = FFmpegKit.executeWithArguments(base)
                if (!ReturnCode.isSuccess(baseSession.getReturnCode()) || basePng.length() <= 0L) {
                    throw IllegalStateException(
                        baseSession.getOutput().takeLast(1200).ifBlank { "Native 无字幕预览生成失败" }
                    )
                }
                val subSession = FFmpegKit.executeWithArguments(sub)
                if (!ReturnCode.isSuccess(subSession.getReturnCode()) || subPng.length() <= 0L) {
                    throw IllegalStateException(
                        subSession.getOutput().takeLast(1200).ifBlank { "Native 字幕预览生成失败" }
                    )
                }

                val baseBitmap = BitmapFactory.decodeFile(basePng.absolutePath)
                    ?: throw IllegalStateException("无法解码 Native 无字幕预览")
                val subBitmap = BitmapFactory.decodeFile(subPng.absolutePath)
                    ?: throw IllegalStateException("无法解码 Native 字幕预览")

                val visualChange = bitmapsDiffer(baseBitmap, subBitmap)
                val subUrl = bitmapDataUrl(subBitmap)
                val baseUrl = bitmapDataUrl(baseBitmap)
                baseBitmap.recycle()
                subBitmap.recycle()

                result
                    .put("ok", true)
                    .put("url", subUrl)
                    .put("baseUrl", baseUrl)
                    .put("visualChange", visualChange)
                    .put("time", timeSeconds)
            } catch (e: Throwable) {
                result
                    .put("ok", false)
                    .put("error", e.message ?: e.javaClass.simpleName)
            } finally {
                if (!safUrl.isNullOrBlank()) {
                    try { FFmpegKitConfig.unregisterSafProtocolUrl(safUrl) } catch (_: Throwable) {}
                }
                try { previewRoot.deleteRecursively() } catch (_: Throwable) {}
                try { FFmpegKitConfig.clearSessions() } catch (_: Throwable) {}
            }
            postJsonCallback("__onNativePreview", result)
        }
    }

    private fun bitmapsDiffer(a: Bitmap, b: Bitmap): Boolean {
        if (a.width != b.width || a.height != b.height) return true
        val pixels = a.width.toLong() * a.height.toLong()
        val step = maxOf(1L, pixels / 250_000L).toInt()
        var changed = 0
        var index = 0L
        while (index < pixels) {
            val x = (index % a.width).toInt()
            val y = (index / a.width).toInt()
            val p1 = a.getPixel(x, y)
            val p2 = b.getPixel(x, y)
            if (
                kotlin.math.abs(android.graphics.Color.red(p1) - android.graphics.Color.red(p2)) > 2 ||
                kotlin.math.abs(android.graphics.Color.green(p1) - android.graphics.Color.green(p2)) > 2 ||
                kotlin.math.abs(android.graphics.Color.blue(p1) - android.graphics.Color.blue(p2)) > 2
            ) {
                changed++
                if (changed >= 8) return true
            }
            index += step
        }
        return false
    }

    private fun bitmapDataUrl(bitmap: Bitmap): String {
        val bytes = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, 84, bytes)
        return "data:image/jpeg;base64," +
            Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP)
    }

    @JavascriptInterface
    fun startNativeEncode(requestJson: String, assText: String): String {
        val result = JSONObject()
        try {
            val inputUri = getPickedUris("video").firstOrNull()
                ?: throw IllegalStateException("没有可供 Native 压制使用的视频 URI")
            if (assText.isBlank()) throw IllegalStateException("处理后的 ASS 字幕为空")
            if (assText.toByteArray(Charsets.UTF_8).size > 8 * 1024 * 1024) {
                throw IllegalStateException("ASS 字幕超过 8 MB 安全上限")
            }

            val incoming = JSONObject(requestJson)
            val codec = incoming.optString("codec", "")
            val mode = incoming.optString("mode", "")
            val preset = incoming.optString("preset", "")
            val crf = incoming.optInt("crf", -1)
            val bitrate = incoming.optLong("targetVideoBitrate", 0L)
            val expectedDuration = incoming.optDouble("expectedDuration", 0.0)
            val expectedAudioTracks = incoming.optInt("expectedAudioTracks", -1)
            val suggestedName = NativeJobStore.sanitizeFileName(
                incoming.optString("suggestedName", "hardsub_" + codec + ".mkv")
            ).let { if (it.lowercase().endsWith(".mkv")) it else it + ".mkv" }

            val x26xPresets = setOf(
                "ultrafast", "superfast", "veryfast", "faster", "fast",
                "medium", "slow", "slower", "veryslow"
            )
            when (codec) {
                "h264", "h265" -> if (preset !in x26xPresets) {
                    throw IllegalStateException("x264/x265 preset 不在允许范围")
                }
                "av1" -> {
                    val p = preset.toIntOrNull()
                        ?: throw IllegalStateException("SVT-AV1 preset 必须是整数")
                    if (p !in 0..13) throw IllegalStateException("SVT-AV1 preset 不在 0..13")
                }
                else -> throw IllegalStateException("未知编码器")
            }
            when (mode) {
                "crf" -> {
                    val maxCrf = if (codec == "av1") 63 else 51
                    if (crf !in 0..maxCrf) throw IllegalStateException("CRF 超出允许范围")
                }
                "budget-rate" -> {
                    if (bitrate !in 150_000L..200_000_000L) {
                        throw IllegalStateException("目标视频码率超出允许范围")
                    }
                }
                else -> throw IllegalStateException("未知码率控制模式")
            }
            if (!(expectedDuration > 0.0)) throw IllegalStateException("缺少有效视频时长")
            if (expectedAudioTracks < 0 || expectedAudioTracks > 32) {
                throw IllegalStateException("音频轨数量无效")
            }

            NativeJobStore.cleanupOldJobs(activity)

            val jobId = UUID.randomUUID().toString()
            val jobDir = NativeJobStore.jobDir(activity, jobId)
            if (!jobDir.mkdirs() && !jobDir.isDirectory) {
                throw IllegalStateException("无法创建 Native 任务目录")
            }

            NativeJobStore.assFile(activity, jobId).writeText(assText, Charsets.UTF_8)

            val fontUris = JSONArray()
            getPickedUris("fonts").forEach { fontUris.put(it.toString()) }

            val request = JSONObject()
                .put("inputUri", inputUri.toString())
                .put("fontUris", fontUris)
                .put("codec", codec)
                .put("mode", mode)
                .put("preset", preset)
                .put("crf", crf)
                .put("targetVideoBitrate", bitrate)
                .put("expectedDuration", expectedDuration)
                .put("expectedAudioTracks", expectedAudioTracks)
                .put("suggestedName", suggestedName)

            NativeJobStore.writeJsonAtomic(
                NativeJobStore.requestFile(activity, jobId),
                request
            )
            NativeJobStore.writeStatus(
                activity,
                jobId,
                JSONObject()
                    .put("state", "queued")
                    .put("message", "已创建 Android 原生压制任务")
                    .put("progress", 0.0)
                    .put("suggestedName", suggestedName)
            )

            val intent = Intent(activity, EncodeService::class.java).apply {
                action = EncodeService.ACTION_START
                putExtra(EncodeService.EXTRA_JOB_ID, jobId)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                activity.startForegroundService(intent)
            } else {
                activity.startService(intent)
            }

            result.put("ok", true)
                .put("jobId", jobId)
                .put("suggestedName", suggestedName)
        } catch (e: Throwable) {
            result.put("ok", false)
                .put("error", e.message ?: e.javaClass.simpleName)
        }
        return result.toString()
    }

    @JavascriptInterface
    fun getNativeJobStatus(jobId: String): String {
        if (!NativeJobStore.isSafeJobId(jobId)) {
            return JSONObject()
                .put("ok", false)
                .put("error", "无效 Native job id")
                .toString()
        }
        val status = NativeJobStore.readStatus(activity, jobId)
            ?: return JSONObject()
                .put("ok", false)
                .put("error", "找不到 Native 任务状态")
                .toString()
        return status.put("ok", true).toString()
    }

    @JavascriptInterface
    fun cancelNativeEncode(jobId: String) {
        if (!NativeJobStore.isSafeJobId(jobId)) return
        val intent = Intent(activity, EncodeService::class.java).apply {
            action = EncodeService.ACTION_CANCEL
            putExtra(EncodeService.EXTRA_JOB_ID, jobId)
        }
        try {
            activity.startService(intent)
        } catch (_: Throwable) {
            FFmpegKit.cancel()
        }
    }

    @JavascriptInterface
    fun requestNativeExport(jobId: String, suggestedName: String) {
        if (!NativeJobStore.isSafeJobId(jobId)) return
        val safeName = NativeJobStore.sanitizeFileName(suggestedName)
            .let { if (it.lowercase().endsWith(".mkv")) it else it + ".mkv" }
        (activity as? MainActivity)?.requestNativeExport(jobId, safeName)
    }

    fun exportJobOutput(jobId: String, destination: Uri) {
        thread(name = "native-export-" + jobId.take(8)) {
            val result = JSONObject().put("jobId", jobId)
            try {
                if (!NativeJobStore.isSafeJobId(jobId)) {
                    throw IllegalStateException("无效 Native job id")
                }
                val status = NativeJobStore.readStatus(activity, jobId)
                    ?: throw IllegalStateException("找不到 Native 任务")
                if (status.optString("state") != "completed") {
                    throw IllegalStateException("Native 压制尚未完成")
                }
                val output = NativeJobStore.outputFile(activity, jobId)
                if (!output.isFile || output.length() <= 0L) {
                    throw IllegalStateException("Native 成品文件不存在")
                }

                activity.contentResolver.openOutputStream(destination, "w")?.use { out ->
                    output.inputStream().use { input ->
                        input.copyTo(out, 1024 * 1024)
                    }
                } ?: throw IllegalStateException("无法打开目标保存位置")

                result
                    .put("ok", true)
                    .put("bytes", output.length())
                    .put("sha256", status.optString("sha256", ""))
            } catch (e: Throwable) {
                result
                    .put("ok", false)
                    .put("error", e.message ?: e.javaClass.simpleName)
            }
            postJsonCallback("__onNativeExportResult", result)
        }
    }

    @JavascriptInterface
    fun openExternalUrl(url: String) {
        val uri = try { Uri.parse(url) } catch (_: Throwable) { return }
        val trusted =
            uri.scheme.equals("https", ignoreCase = true) &&
            uri.host.equals(UPDATE_DOWNLOAD_HOST, ignoreCase = true) &&
            uri.path.orEmpty().startsWith(UPDATE_DOWNLOAD_PATH_PREFIX) &&
            uri.path.orEmpty().endsWith(".apk", ignoreCase = true)
        if (!trusted) return

        activity.runOnUiThread {
            try {
                activity.startActivity(Intent(Intent.ACTION_VIEW, uri))
            } catch (_: Throwable) {
                // Leave the current app running if no external handler exists.
            }
        }
    }

    private fun prepareNativeFonts(): Pair<List<String>, Boolean> {
        val fontDirs = mutableListOf<String>()

        listOf(
            "/system/fonts",
            "/product/fonts",
            "/system_ext/fonts"
        ).forEach { path ->
            if (File(path).isDirectory) fontDirs.add(path)
        }

        var bundledFallbackReady = false
        try {
            val appFontDir = File(activity.filesDir, "fonts")
            if (!appFontDir.exists()) appFontDir.mkdirs()

            val fallback = File(appFontDir, "NotoSansSC-Regular.otf")
            if (!fallback.exists() || fallback.length() == 0L) {
                activity.assets.open("www/vendor/fallback-fonts/NotoSansSC-Regular.otf").use { input ->
                    fallback.outputStream().use { output -> input.copyTo(output) }
                }
            }

            if (fallback.isFile && fallback.length() > 0L) {
                bundledFallbackReady = true
                fontDirs.add(appFontDir.absolutePath)
            }
        } catch (_: Throwable) {
            bundledFallbackReady = false
        }

        FFmpegKitConfig.setFontDirectoryList(
            activity,
            fontDirs.distinct(),
            emptyMap<String?, String?>()
        )

        return fontDirs.distinct() to bundledFallbackReady
    }

    private fun executeOk(args: Array<String>): Pair<Boolean, String> {
        val session = FFmpegKit.executeWithArguments(args)
        val ok = ReturnCode.isSuccess(session.getReturnCode())
        return ok to session.getOutput()
    }

    private fun codecSmoke(
        encoder: String,
        presetArgs: Array<String>,
        output: File
    ): Pair<Boolean, String> {
        output.delete()
        val args = mutableListOf(
            "-y",
            "-f", "lavfi",
            "-i", "testsrc2=size=160x96:rate=12:duration=0.5",
            "-an",
            "-frames:v", "6",
            "-c:v", encoder
        )
        args.addAll(presetArgs.asList())
        args.addAll(listOf("-pix_fmt", "yuv420p", output.absolutePath))

        val (encodeOk, logs) = executeOk(args.toTypedArray())
        if (!encodeOk || output.length() <= 0) {
            return false to logs
        }

        val probe = FFprobeKit.getMediaInformation(output.absolutePath)
        return (probe.getMediaInformation() != null) to logs
    }

    private fun libassVisualSmoke(assFile: File, fallbackFontDir: String): Pair<Boolean, String> {
        val base = File(activity.cacheDir, "native_hardsub_selftest_base.raw")
        val sub = File(activity.cacheDir, "native_hardsub_selftest_sub.raw")
        base.delete()
        sub.delete()

        val common = arrayOf(
            "-y",
            "-f", "lavfi",
            "-i", "color=c=black:s=320x180:r=1:d=1",
            "-frames:v", "1",
            "-pix_fmt", "rgb24"
        )

        val baseArgs = common + arrayOf("-f", "rawvideo", base.absolutePath)
        val (baseOk, baseLogs) = executeOk(baseArgs)
        if (!baseOk || base.length() <= 0) return false to baseLogs

        val subArgs = arrayOf(
            "-y",
            "-f", "lavfi",
            "-i", "color=c=black:s=320x180:r=1:d=1",
            "-vf", "ass=${assFile.absolutePath}:fontsdir=${fallbackFontDir}",
            "-frames:v", "1",
            "-pix_fmt", "rgb24",
            "-f", "rawvideo",
            sub.absolutePath
        )
        val (subOk, subLogs) = executeOk(subArgs)
        if (!subOk || sub.length() <= 0) return false to subLogs

        val different = !base.readBytes().contentEquals(sub.readBytes())
        base.delete()
        sub.delete()
        return different to subLogs
    }

    @JavascriptInterface
    fun runSelfTest() {
        thread(name = "native-hardsub-selftest") {
            val result = JSONObject()
            result.put("available", true)

            val tempFiles = mutableListOf<File>()
            try {
                // Keep only a small bounded history. FFmpegKit sessions retain logs and
                // callbacks, so an unbounded history is undesirable for a long-running app.
                FFmpegKitConfig.setSessionHistorySize(12)

                val encoders = FFmpegKit.executeWithArguments(arrayOf("-hide_banner", "-encoders")).getOutput()
                val decoders = FFmpegKit.executeWithArguments(arrayOf("-hide_banner", "-decoders")).getOutput()
                val filters = FFmpegKit.executeWithArguments(arrayOf("-hide_banner", "-filters")).getOutput()

                val hasX264 = Regex("""\blibx264\b""").containsMatchIn(encoders)
                val hasX265 = Regex("""\blibx265\b""").containsMatchIn(encoders)
                val hasSvt = Regex("""\blibsvtav1\b""").containsMatchIn(encoders)
                val hasDav1d = Regex("""\blibdav1d\b""").containsMatchIn(decoders)
                val hasAss = Regex("""\bass\b""").containsMatchIn(filters)

                result.put("x264", hasX264)
                result.put("x265", hasX265)
                result.put("svtAv1", hasSvt)
                result.put("dav1d", hasDav1d)
                result.put("assFilter", hasAss)
                result.put("h264MediaCodec", encoders.contains("h264_mediacodec"))
                result.put("hevcMediaCodec", encoders.contains("hevc_mediacodec"))
                result.put("av1MediaCodec", encoders.contains("av1_mediacodec"))

                val (nativeFontDirs, bundledFallbackReady) = prepareNativeFonts()
                result.put("fontDirs", nativeFontDirs.joinToString(" | "))
                result.put("bundledFallbackReady", bundledFallbackReady)

                val assFile = File(activity.cacheDir, "native_hardsub_selftest.ass")
                tempFiles.add(assFile)
                assFile.writeText(
                    """
                    [Script Info]
                    ScriptType: v4.00+
                    PlayResX: 320
                    PlayResY: 180

                    [V4+ Styles]
                    Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
                    Style: Default,Noto Sans SC,28,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,18,1

                    [Events]
                    Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
                    Dialogue: 0,0:00:00.00,0:00:00.80,Default,,0,0,0,,native libass test
                    """.trimIndent()
                )

                val fallbackFontDir = nativeFontDirs.lastOrNull { it.startsWith(activity.filesDir.absolutePath) }
                    ?: nativeFontDirs.firstOrNull()
                    ?: "/system/fonts"
                val libassVisual = if (hasAss && bundledFallbackReady) {
                    libassVisualSmoke(assFile, fallbackFontDir)
                } else {
                    false to if (!hasAss) "ass filter missing" else "bundled fallback font unavailable"
                }
                result.put("libassVisualSmoke", libassVisual.first)
                if (!libassVisual.first) {
                    result.put("libassError", libassVisual.second.takeLast(1200))
                }

                val x264Out = File(activity.cacheDir, "native_hardsub_selftest_x264.mkv")
                val x265Out = File(activity.cacheDir, "native_hardsub_selftest_x265.mkv")
                val av1Out = File(activity.cacheDir, "native_hardsub_selftest_av1.mkv")
                tempFiles.addAll(listOf(x264Out, x265Out, av1Out))

                val x264Smoke = if (hasX264) {
                    codecSmoke("libx264", arrayOf("-preset", "ultrafast", "-crf", "30"), x264Out)
                } else false to "libx264 missing"

                val x265Smoke = if (hasX265) {
                    codecSmoke("libx265", arrayOf("-preset", "ultrafast", "-crf", "32"), x265Out)
                } else false to "libx265 missing"

                val av1Smoke = if (hasSvt) {
                    codecSmoke(
                        "libsvtav1",
                        arrayOf("-preset", "12", "-crf", "40", "-svtav1-params", "lp=2"),
                        av1Out
                    )
                } else false to "libsvtav1 missing"

                result.put("x264EncodeSmoke", x264Smoke.first)
                result.put("x265EncodeSmoke", x265Smoke.first)
                result.put("svtAv1EncodeSmoke", av1Smoke.first)

                if (!x264Smoke.first) result.put("x264Error", x264Smoke.second.takeLast(1200))
                if (!x265Smoke.first) result.put("x265Error", x265Smoke.second.takeLast(1200))
                if (!av1Smoke.first) result.put("svtAv1Error", av1Smoke.second.takeLast(1200))

                val allSoftwareSmoke =
                    libassVisual.first &&
                    x264Smoke.first &&
                    x265Smoke.first &&
                    av1Smoke.first

                result.put("softwareEncodeSmoke", allSoftwareSmoke)
                result.put("ffprobeSmoke", x264Smoke.first && x265Smoke.first && av1Smoke.first)
            } catch (e: Throwable) {
                result.put("softwareEncodeSmoke", false)
                result.put("ffprobeSmoke", false)
                result.put("error", e.message ?: e.javaClass.simpleName)
            } finally {
                tempFiles.forEach { file ->
                    try { file.delete() } catch (_: Throwable) {}
                }
                try { FFmpegKitConfig.clearSessions() } catch (_: Throwable) {}
            }

            postJsonCallback("__onNativeSelfTest", result)
        }
    }

    @JavascriptInterface
    fun cancelAll() {
        FFmpegKit.cancel()
    }
}
