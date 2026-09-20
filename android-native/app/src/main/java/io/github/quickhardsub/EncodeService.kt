package io.github.quickhardsub

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import com.arthenica.ffmpegkit.FFmpegKit
import com.arthenica.ffmpegkit.FFmpegKitConfig
import com.arthenica.ffmpegkit.FFprobeKit
import com.arthenica.ffmpegkit.ReturnCode
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

class EncodeService : Service() {
    companion object {
        const val CHANNEL_ID = "native_encode"
        const val NOTIFICATION_ID = 1402
        const val ACTION_START = "io.github.quickhardsub.action.START_ENCODE"
        const val ACTION_CANCEL = "io.github.quickhardsub.action.CANCEL_ENCODE"
        const val EXTRA_JOB_ID = "job_id"

        private val processRunning = AtomicBoolean(false)

        fun isEncoding(): Boolean = processRunning.get()
    }

    @Volatile
    private var activeJobId: String? = null

    @Volatile
    private var activeSessionId: Long? = null

    @Volatile
    private var cancelRequested = false

    @Volatile
    private var timeoutTriggered = false

    private var wakeLock: PowerManager.WakeLock? = null

    override fun onCreate() {
        super.onCreate()
        FFmpegKitConfig.setSessionHistorySize(10)

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

    private fun buildNotification(text: String, progress: Int? = null): Notification {
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }

        val cancelIntent = Intent(this, EncodeService::class.java).apply {
            action = ACTION_CANCEL
            activeJobId?.let { putExtra(EXTRA_JOB_ID, it) }
        }
        val cancelPending = PendingIntent.getService(
            this,
            1403,
            cancelIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        builder
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setContentTitle("快捷自动硬字幕压制器")
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "取消", cancelPending)

        if (progress != null) {
            builder.setProgress(100, progress.coerceIn(0, 100), false)
        } else {
            builder.setProgress(0, 0, true)
        }
        return builder.build()
    }

    private fun promote(text: String, progress: Int? = null) {
        val notification = buildNotification(text, progress)
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

    private fun updateNotification(text: String, progress: Int? = null) {
        getSystemService(NotificationManager::class.java)
            .notify(NOTIFICATION_ID, buildNotification(text, progress))
    }

    private fun stopEncodeService() {
        releaseWakeLock()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun acquireWakeLock() {
        if (wakeLock?.isHeld == true) return
        val power = getSystemService(PowerManager::class.java)
        wakeLock = power.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "QuickHardsub::NativeEncode"
        ).apply {
            setReferenceCounted(false)
            acquire(6L * 60L * 60L * 1000L)
        }
    }

    private fun releaseWakeLock() {
        try {
            wakeLock?.takeIf { it.isHeld }?.release()
        } catch (_: Throwable) {}
        wakeLock = null
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action
        val jobId = intent?.getStringExtra(EXTRA_JOB_ID).orEmpty()

        if (action == ACTION_CANCEL) {
            if (jobId.isBlank() || jobId == activeJobId) {
                cancelRequested = true
                activeSessionId?.let(FFmpegKit::cancel) ?: FFmpegKit.cancel()
                activeJobId?.let { id ->
                    val current = NativeJobStore.readStatus(this, id) ?: JSONObject()
                    current.put("state", "cancelling")
                    current.put("message", "正在取消原生压制…")
                    NativeJobStore.writeStatus(this, id, current)
                }
                updateNotification("正在取消…", null)
            }
            return START_NOT_STICKY
        }

        if (action != ACTION_START || !NativeJobStore.isSafeJobId(jobId)) {
            stopEncodeService()
            return START_NOT_STICKY
        }

        if (!processRunning.compareAndSet(false, true)) {
            NativeJobStore.writeStatus(
                this,
                jobId,
                JSONObject()
                    .put("state", "failed")
                    .put("error", "已有 Android 原生压制任务正在运行")
            )
            return START_NOT_STICKY
        }

        activeJobId = jobId
        cancelRequested = false
        timeoutTriggered = false
        promote("准备 Android 原生压制…")
        acquireWakeLock()

        thread(name = "native-encode-" + jobId.take(8)) {
            try {
                runJob(jobId)
            } finally {
                activeSessionId = null
                activeJobId = null
                cancelRequested = false
                timeoutTriggered = false
                processRunning.set(false)
                try { FFmpegKitConfig.clearSessions() } catch (_: Throwable) {}
                stopEncodeService()
            }
        }

        return START_NOT_STICKY
    }

    private fun runJob(jobId: String) {
        val requestFile = NativeJobStore.requestFile(this, jobId)
        if (!requestFile.isFile) {
            fail(jobId, "原生任务请求文件不存在")
            return
        }

        val request = try {
            JSONObject(requestFile.readText(Charsets.UTF_8))
        } catch (e: Throwable) {
            fail(jobId, "原生任务请求损坏：" + (e.message ?: e.javaClass.simpleName))
            return
        }

        val jobDir = NativeJobStore.jobDir(this, jobId)
        val assFile = NativeJobStore.assFile(this, jobId)
        val output = NativeJobStore.outputFile(this, jobId)
        val fontsDir = File(jobDir, "fonts")
        var stagedInput: File? = null
        var safUrl: String? = null

        try {
            updateStatus(jobId, "staging", "准备输入、字幕和字体", 0.0)

            if (!assFile.isFile || assFile.length() <= 0L) {
                throw IllegalStateException("处理后的 ASS 字幕为空")
            }

            val inputUri = Uri.parse(request.getString("inputUri"))
            val fontUris = request.optJSONArray("fontUris") ?: JSONArray()

            if (fontsDir.exists()) fontsDir.deleteRecursively()
            fontsDir.mkdirs()

            for (index in 0 until fontUris.length()) {
                checkCancelled()
                val uri = Uri.parse(fontUris.getString(index))
                val originalName = NativeJobStore.displayName(this, uri, "font_" + index + ".ttf")
                val target = File(fontsDir, index.toString().padStart(3, '0') + "_" + originalName)
                NativeJobStore.copyUriToFile(this, uri, target)
            }

            val (_, fallbackReady) = NativeJobStore.configureFonts(
                this,
                if (fontsDir.listFiles()?.isNotEmpty() == true) listOf(fontsDir.absolutePath) else emptyList()
            )
            if (!fallbackReady) {
                throw IllegalStateException("内置 Noto Sans SC 回退字体不可用")
            }

            val seekable = NativeJobStore.isSeekable(this, inputUri)
            val inputPath: String
            if (seekable) {
                safUrl = FFmpegKitConfig.getSafParameterForRead(this, inputUri, true)
                if (safUrl.isNullOrBlank()) {
                    throw IllegalStateException("无法创建 FFmpegKit SAF 输入 URL")
                }
                inputPath = safUrl!!
            } else {
                val inputName = NativeJobStore.displayName(this, inputUri, "input.bin")
                stagedInput = File(jobDir, "input_" + inputName)
                val allocatable = NativeJobStore.allocatableBytes(this)
                val sourceSize = try {
                    contentResolver.openFileDescriptor(inputUri, "r")?.use { it.statSize } ?: -1L
                } catch (_: Throwable) { -1L }

                if (sourceSize > 0L && allocatable < sourceSize + 256L * 1024L * 1024L) {
                    throw IllegalStateException(
                        "本地 staging 空间不足：需要至少约 " +
                            humanBytes(sourceSize + 256L * 1024L * 1024L) +
                            "，当前可分配约 " + humanBytes(allocatable)
                    )
                }

                updateStatus(jobId, "staging", "输入不可 seek，正在复制到应用私有 staging", 0.0)
                NativeJobStore.copyUriToFile(this, inputUri, stagedInput!!)
                inputPath = stagedInput!!.absolutePath
            }

            checkCancelled()

            val sourceProbe = FFprobeKit.getMediaInformation(inputPath)
            val sourceInfo = sourceProbe.getMediaInformation()
                ?: throw IllegalStateException(
                    sourceProbe.getOutput().takeLast(1200).ifBlank { "FFprobe 无法读取输入视频" }
                )

            val sourceStreams = sourceInfo.getStreams()
            val video = sourceStreams.firstOrNull { it.getType() == "video" }
                ?: throw IllegalStateException("输入没有可识别的视频流")
            val audioStreams = sourceStreams.filter { it.getType() == "audio" }
            val audioTracks = audioStreams.size
            val requestedAudioTracks = request.optInt("expectedAudioTracks", -1)
            if (requestedAudioTracks >= 0 && requestedAudioTracks != audioTracks) {
                throw IllegalStateException(
                    "输入音频轨数量与预检结果不一致：" + audioTracks +
                        "，预检为 " + requestedAudioTracks
                )
            }
            val props = video.getAllProperties()
            val pixelFormat = video.getFormat().orEmpty()
            val bitDepth = inferBitDepth(props?.optString("bits_per_raw_sample", "").orEmpty(), pixelFormat)
            val transfer = props?.optString("color_transfer", "").orEmpty()
            val primaries = props?.optString("color_primaries", "").orEmpty()
            val hdr = transfer.contains("smpte2084", true) ||
                transfer.contains("arib-std-b67", true) ||
                (primaries.contains("bt2020", true) && bitDepth > 8)
            if (bitDepth > 8 || hdr) {
                throw IllegalStateException(
                    "检测到 " + bitDepth + "-bit/HDR 输入；当前 Native 正式压制仍禁止静默转换为 8-bit SDR"
                )
            }

            val duration = sourceInfo.getDuration()?.toDoubleOrNull()
                ?: request.optDouble("expectedDuration", 0.0)
            if (!(duration > 0.0)) {
                throw IllegalStateException("无法取得有效视频时长")
            }

            val expectedVideoDuration =
                props?.optString("duration", "")?.toDoubleOrNull()
                    ?.takeIf { it > 0.0 }
                    ?: duration
            val expectedAudioDuration = audioStreams
                .mapNotNull { stream ->
                    stream.getAllProperties()
                        ?.optString("duration", "")
                        ?.toDoubleOrNull()
                        ?.takeIf { it > 0.0 }
                }
                .maxOrNull()
                ?: duration

            val codec = request.getString("codec")
            val mode = request.getString("mode")
            val preset = request.getString("preset")
            val crf = request.optInt("crf", 0)
            val bitrate = request.optLong("targetVideoBitrate", 0L)

            validateEncodeSettings(codec, mode, preset, crf, bitrate)

            output.delete()
            val filterParts = mutableListOf(
                "ass=" + NativeJobStore.escapeFilterPath(assFile.absolutePath) +
                    ":fontsdir=" + NativeJobStore.escapeFilterPath(fontsDir.absolutePath)
            )
            val width = video.getWidth()?.toInt() ?: 0
            val height = video.getHeight()?.toInt() ?: 0
            if ((width > 0 && width % 2 != 0) || (height > 0 && height % 2 != 0)) {
                filterParts.add("pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0")
            }

            val encoder = when (codec) {
                "h264" -> "libx264"
                "h265" -> "libx265"
                "av1" -> "libsvtav1"
                else -> throw IllegalStateException("未知编码器")
            }

            val fps = parseFps(video.getAverageFrameRate())
            val gop = max(48, min(300, ((if (fps > 0.0) fps else 30.0) * 5.0).toInt()))

            val args = mutableListOf(
                "-y",
                "-hide_banner",
                "-i", inputPath,
                "-map", "0:v:0",
                "-map", "0:a?",
                "-sn",
                "-dn",
                "-vf", filterParts.joinToString(","),
                "-c:v", encoder,
                "-preset", preset,
                "-g", gop.toString()
            )

            if (mode == "budget-rate") {
                args.addAll(listOf("-b:v", bitrate.toString()))
            } else {
                args.addAll(listOf("-crf", crf.toString()))
            }

            if (codec == "av1") {
                val lp = Runtime.getRuntime().availableProcessors().coerceIn(1, 4)
                args.addAll(listOf("-svtav1-params", "lp=" + lp))
            }

            args.addAll(
                listOf(
                    "-pix_fmt", "yuv420p",
                    "-c:a", "copy",
                    "-map_metadata", "0",
                    "-map_chapters", "0",
                    "-f", "matroska",
                    output.absolutePath
                )
            )

            updateStatus(jobId, "encoding", "Android 原生 FFmpeg 正在压制", 0.0)
            updateNotification("正在压制… 0%", 0)

            val latch = CountDownLatch(1)
            var returnCode: ReturnCode? = null
            var lastOutput = ""
            var lastStatusWrite = 0L
            var lastNotification = 0L

            val session = FFmpegKit.executeWithArgumentsAsync(
                args.toTypedArray(),
                { completed ->
                    returnCode = completed.getReturnCode()
                    lastOutput = completed.getOutput()
                    latch.countDown()
                },
                { log ->
                    val message = log.message
                    if (message.isNotBlank()) {
                        lastOutput = (lastOutput + message).takeLast(5000)
                    }
                },
                { statistics ->
                    val now = System.currentTimeMillis()
                    val processedMs = statistics.time.coerceAtLeast(0.0)
                    val progress = (processedMs / (duration * 1000.0)).coerceIn(0.0, 0.985)

                    if (now - lastStatusWrite >= 500L) {
                        lastStatusWrite = now
                        NativeJobStore.writeStatus(
                            this,
                            jobId,
                            JSONObject()
                                .put("state", "encoding")
                                .put("message", "Android 原生 FFmpeg 正在压制")
                                .put("progress", progress)
                                .put("timeMs", processedMs)
                                .put("fps", statistics.videoFps)
                                .put("speed", statistics.speed)
                                .put("sizeBytes", statistics.size)
                                .put("frame", statistics.videoFrameNumber)
                                .put("duration", duration)
                        )
                    }

                    if (now - lastNotification >= 1500L) {
                        lastNotification = now
                        val percent = (progress * 100.0).toInt().coerceIn(0, 98)
                        updateNotification("正在压制… " + percent + "%", percent)
                    }
                }
            )
            activeSessionId = session.getSessionId()

            while (!latch.await(1, TimeUnit.SECONDS)) {
                if (cancelRequested) {
                    activeSessionId?.let(FFmpegKit::cancel)
                }
            }
            activeSessionId = null

            if (cancelRequested || ReturnCode.isCancel(returnCode)) {
                output.delete()
                if (!timeoutTriggered) {
                    NativeJobStore.writeStatus(
                        this,
                        jobId,
                        JSONObject()
                            .put("state", "cancelled")
                            .put("message", "原生压制已取消")
                    )
                }
                return
            }

            if (!ReturnCode.isSuccess(returnCode) || !output.isFile || output.length() <= 0L) {
                throw IllegalStateException(
                    lastOutput.takeLast(1800).ifBlank { "FFmpeg 原生压制失败，返回码=" + returnCode }
                )
            }

            checkCancelled()
            updateStatus(jobId, "validating", "编码完成，正在扫描成品完整性", 0.99)
            updateNotification("正在验证成品…", 99)

            val outputProbe = FFprobeKit.getMediaInformation(output.absolutePath)
            val outputInfo = outputProbe.getMediaInformation()
                ?: throw IllegalStateException(
                    outputProbe.getOutput().takeLast(1200).ifBlank { "FFprobe 无法读取成品" }
                )
            val outputStreams = outputInfo.getStreams()
            val outputVideoCount = outputStreams.count { it.getType() == "video" }
            val outputAudioCount = outputStreams.count { it.getType() == "audio" }
            val outputDuration = outputInfo.getDuration()?.toDoubleOrNull() ?: 0.0
            val durationDelta = outputDuration - duration
            val tolerance = max(0.75, if (fps > 0.0) 2.0 / fps else 0.0)

            if (outputVideoCount != 1) {
                throw IllegalStateException("成品视频流数量异常：" + outputVideoCount)
            }
            if (outputAudioCount != audioTracks) {
                throw IllegalStateException(
                    "成品音频轨数量异常：" + outputAudioCount + "，输入为 " + audioTracks
                )
            }

            val videoScan = fullDemuxScan(output.absolutePath, "0:v:0")
            checkCancelled()
            val audioScan = if (audioTracks > 0) {
                fullDemuxScan(output.absolutePath, "0:a")
            } else {
                null
            }
            val videoEnd = videoScan.first
            val audioEnd = audioScan?.first
            val videoDelta = videoEnd - expectedVideoDuration
            val audioDelta = audioEnd?.minus(expectedAudioDuration)
            val audioTolerance = 1.0

            if (!(outputDuration > 0.0) || abs(durationDelta) > max(2.0, tolerance * 2.0)) {
                throw IllegalStateException(
                    "成品容器时长异常：输入容器 " + String.format("%.3f", duration) +
                        " s，输出 " + String.format("%.3f", outputDuration) + " s"
                )
            }
            if (!(videoEnd > 0.0) || abs(videoDelta) > tolerance) {
                throw IllegalStateException(
                    "成品视频 packet 末端异常：输入视频约 " +
                        String.format("%.3f", expectedVideoDuration) +
                        " s，扫描末端 " + String.format("%.3f", videoEnd) + " s"
                )
            }
            if (
                audioTracks > 0 &&
                (
                    audioEnd == null ||
                    !(audioEnd > 0.0) ||
                    audioDelta == null ||
                    abs(audioDelta) > audioTolerance
                )
            ) {
                throw IllegalStateException(
                    "成品音频 packet 末端异常：输入音频约 " +
                        String.format("%.3f", expectedAudioDuration) +
                        " s，扫描末端 " +
                        (audioEnd?.let { String.format("%.3f", it) } ?: "N/A") + " s"
                )
            }

            val sha256 = sha256(output)
            val suggestedName = request.optString("suggestedName", "hardsub_" + codec + ".mkv")

            NativeJobStore.writeStatus(
                this,
                jobId,
                JSONObject()
                    .put("state", "completed")
                    .put("message", "原生压制与完整性扫描通过")
                    .put("progress", 1.0)
                    .put("duration", duration)
                    .put("outputDuration", outputDuration)
                    .put("durationDelta", durationDelta)
                    .put("expectedVideoDuration", expectedVideoDuration)
                    .put("videoEnd", videoEnd)
                    .put("videoEndDelta", videoDelta)
                    .put("expectedAudioDuration", if (audioTracks > 0) expectedAudioDuration else JSONObject.NULL)
                    .put("audioEnd", audioEnd)
                    .put("audioEndDelta", audioDelta)
                    .put("tolerance", tolerance)
                    .put("audioTolerance", audioTolerance)
                    .put("audioTracks", outputAudioCount)
                    .put("scanOk", true)
                    .put("scanMode", "full-demux-to-null")
                    .put("outputBytes", output.length())
                    .put("sha256", sha256)
                    .put("suggestedName", suggestedName)
                    .put("codec", codec)
                    .put("mode", mode)
            )
            updateNotification("压制完成，返回应用保存成品", 100)
        } catch (e: Throwable) {
            if (timeoutTriggered) {
                output.delete()
                // onTimeout already persisted the system-limit failure. Do not
                // overwrite it with a generic cancellation from the worker.
            } else if (cancelRequested) {
                output.delete()
                NativeJobStore.writeStatus(
                    this,
                    jobId,
                    JSONObject()
                        .put("state", "cancelled")
                        .put("message", "原生压制已取消")
                )
            } else {
                output.delete()
                fail(jobId, e.message ?: e.javaClass.simpleName)
            }
        } finally {
            if (!safUrl.isNullOrBlank()) {
                try { FFmpegKitConfig.unregisterSafProtocolUrl(safUrl) } catch (_: Throwable) {}
            }
            try { stagedInput?.delete() } catch (_: Throwable) {}
            try { fontsDir.deleteRecursively() } catch (_: Throwable) {}
        }
    }

    private fun fullDemuxScan(path: String, mapSpec: String): Pair<Double, String> {
        val latch = CountDownLatch(1)
        var returnCode: ReturnCode? = null
        var output = ""
        var lastTimeMs = 0.0

        val session = FFmpegKit.executeWithArgumentsAsync(
            arrayOf(
                "-hide_banner",
                "-v", "error",
                "-stats",
                "-i", path,
                "-map", mapSpec,
                "-c", "copy",
                "-f", "null",
                "-"
            ),
            { completed ->
                returnCode = completed.getReturnCode()
                output = completed.getOutput()
                latch.countDown()
            },
            { log ->
                if (log.message.isNotBlank()) {
                    output = (output + log.message).takeLast(5000)
                }
            },
            { statistics ->
                lastTimeMs = max(lastTimeMs, statistics.time)
            }
        )
        activeSessionId = session.getSessionId()

        while (!latch.await(1, TimeUnit.SECONDS)) {
            if (cancelRequested) {
                activeSessionId?.let(FFmpegKit::cancel)
            }
        }
        activeSessionId = null

        if (cancelRequested || ReturnCode.isCancel(returnCode)) {
            throw InterruptedException("cancelled")
        }
        if (!ReturnCode.isSuccess(returnCode)) {
            throw IllegalStateException(
                output.takeLast(1600).ifBlank { "成品 " + mapSpec + " 全量解复用扫描失败" }
            )
        }
        return Pair(lastTimeMs / 1000.0, output)
    }

    private fun validateEncodeSettings(
        codec: String,
        mode: String,
        preset: String,
        crf: Int,
        bitrate: Long
    ) {
        val x26xPresets = setOf(
            "ultrafast", "superfast", "veryfast", "faster", "fast",
            "medium", "slow", "slower", "veryslow"
        )

        when (codec) {
            "h264", "h265" -> if (preset !in x26xPresets) {
                throw IllegalStateException("x264/x265 preset 不在允许范围")
            }
            "av1" -> {
                val value = preset.toIntOrNull()
                    ?: throw IllegalStateException("SVT-AV1 preset 必须是整数")
                if (value !in 0..13) throw IllegalStateException("SVT-AV1 preset 不在 0..13")
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
    }

    private fun updateStatus(
        jobId: String,
        state: String,
        message: String,
        progress: Double
    ) {
        NativeJobStore.writeStatus(
            this,
            jobId,
            JSONObject()
                .put("state", state)
                .put("message", message)
                .put("progress", progress)
        )
    }

    private fun fail(jobId: String, message: String) {
        NativeJobStore.writeStatus(
            this,
            jobId,
            JSONObject()
                .put("state", "failed")
                .put("message", "原生压制失败")
                .put("error", message.takeLast(2400))
        )
        updateNotification("压制失败，返回应用查看日志", null)
    }

    private fun checkCancelled() {
        if (cancelRequested) throw InterruptedException("cancelled")
    }

    private fun inferBitDepth(explicit: String, pixelFormat: String): Int {
        explicit.toIntOrNull()?.takeIf { it > 0 }?.let { return it }
        val match = Regex("(10|12|14|16)(?:le|be)?", RegexOption.IGNORE_CASE)
            .find(pixelFormat)
        return match?.groupValues?.getOrNull(1)?.toIntOrNull() ?: 8
    }

    private fun parseFps(value: String?): Double {
        if (value.isNullOrBlank()) return 0.0
        val parts = value.split("/")
        return if (parts.size == 2) {
            val a = parts[0].toDoubleOrNull() ?: return 0.0
            val b = parts[1].toDoubleOrNull() ?: return 0.0
            if (b == 0.0) 0.0 else a / b
        } else {
            value.toDoubleOrNull() ?: 0.0
        }
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(1024 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read <= 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { byte ->
            "%02x".format(byte.toInt() and 0xff)
        }
    }

    private fun humanBytes(value: Long): String {
        val mb = value.toDouble() / (1024.0 * 1024.0)
        return if (mb >= 1024.0) {
            String.format("%.2f GB", mb / 1024.0)
        } else {
            String.format("%.0f MB", mb)
        }
    }

    override fun onTimeout(startId: Int, fgsType: Int) {
        timeoutTriggered = true
        cancelRequested = true
        activeSessionId?.let(FFmpegKit::cancel) ?: FFmpegKit.cancel()
        activeJobId?.let { id ->
            NativeJobStore.writeStatus(
                this,
                id,
                JSONObject()
                    .put("state", "failed")
                    .put("error", "Android 15 mediaProcessing 前台服务达到系统时间上限")
            )
        }
        stopEncodeService()
    }

    override fun onDestroy() {
        releaseWakeLock()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
