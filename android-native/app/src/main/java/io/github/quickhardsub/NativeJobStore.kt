package io.github.quickhardsub

import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.storage.StorageManager
import android.provider.OpenableColumns
import android.system.Os
import android.system.OsConstants
import com.arthenica.ffmpegkit.FFmpegKitConfig
import org.json.JSONObject
import java.io.File

object NativeJobStore {
    private val SAFE_JOB_ID = Regex("^[a-f0-9-]{16,64}$")

    fun isSafeJobId(jobId: String): Boolean = SAFE_JOB_ID.matches(jobId)

    fun jobDir(context: Context, jobId: String): File {
        require(isSafeJobId(jobId)) { "invalid job id" }
        return File(context.filesDir, "jobs/" + jobId)
    }

    fun requestFile(context: Context, jobId: String): File =
        File(jobDir(context, jobId), "request.json")

    fun statusFile(context: Context, jobId: String): File =
        File(jobDir(context, jobId), "status.json")

    fun assFile(context: Context, jobId: String): File =
        File(jobDir(context, jobId), "subtitles.ass")

    fun outputFile(context: Context, jobId: String): File =
        File(jobDir(context, jobId), "output.mkv")

    fun writeJsonAtomic(file: File, json: JSONObject) {
        file.parentFile?.mkdirs()
        val tmp = File(file.parentFile, file.name + ".tmp")
        tmp.writeText(json.toString(), Charsets.UTF_8)
        if (!tmp.renameTo(file)) {
            file.writeText(json.toString(), Charsets.UTF_8)
            tmp.delete()
        }
    }

    fun writeStatus(context: Context, jobId: String, json: JSONObject) {
        json.put("jobId", jobId)
        json.put("updatedAt", System.currentTimeMillis())
        writeJsonAtomic(statusFile(context, jobId), json)
    }

    fun readStatus(context: Context, jobId: String): JSONObject? {
        if (!isSafeJobId(jobId)) return null
        val file = statusFile(context, jobId)
        if (!file.isFile) return null
        return try { JSONObject(file.readText(Charsets.UTF_8)) } catch (_: Throwable) { null }
    }

    fun displayName(context: Context, uri: Uri, fallback: String): String {
        try {
            context.contentResolver.query(
                uri,
                arrayOf(OpenableColumns.DISPLAY_NAME),
                null,
                null,
                null
            )?.use { cursor ->
                val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (index >= 0 && cursor.moveToFirst()) {
                    val name = cursor.getString(index)
                    if (!name.isNullOrBlank()) return sanitizeFileName(name)
                }
            }
        } catch (_: Throwable) {}
        return sanitizeFileName(fallback)
    }

    fun sanitizeFileName(name: String): String {
        val cleaned = name
            .replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), "_")
            .trim()
            .take(160)
        return cleaned.ifBlank { "file" }
    }

    fun isSeekable(context: Context, uri: Uri): Boolean {
        return try {
            context.contentResolver.openFileDescriptor(uri, "r")?.use { pfd ->
                Os.lseek(pfd.fileDescriptor, 0L, OsConstants.SEEK_CUR)
                true
            } ?: false
        } catch (_: Throwable) {
            false
        }
    }

    fun copyUriToFile(context: Context, uri: Uri, output: File) {
        output.parentFile?.mkdirs()
        context.contentResolver.openInputStream(uri)?.use { input ->
            output.outputStream().use { out -> input.copyTo(out, 1024 * 1024) }
        } ?: throw IllegalStateException("无法读取所选文件")
        if (!output.isFile || output.length() <= 0L) {
            throw IllegalStateException("复制文件失败：" + output.name)
        }
    }

    fun allocatableBytes(context: Context): Long {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val storage = context.getSystemService(StorageManager::class.java)
                storage.getAllocatableBytes(storage.getUuidForPath(context.filesDir))
            } else {
                context.filesDir.usableSpace
            }
        } catch (_: Throwable) {
            context.filesDir.usableSpace
        }
    }

    data class FontPreparationResult(
        val selectedCount: Int,
        val loadedCount: Int,
        val fallbackCount: Int,
        val selectedUris: List<String>,
        val resolvedPaths: List<String>,
        val passedToFFmpeg: List<String>,
        val fallbackReason: String,
        val fallbackReady: Boolean,
        val fontsDir: File
    )

    fun prepareTaskFonts(
        context: Context,
        fontUris: List<Uri>,
        fontsDir: File
    ): FontPreparationResult {
        if (fontsDir.exists()) {
            try { fontsDir.deleteRecursively() } catch (_: Throwable) {}
        }
        fontsDir.mkdirs()

        val selectedCount = fontUris.size
        val selectedUriStrings = fontUris.map { it.toString() }
        val resolvedPaths = mutableListOf<String>()
        val accessErrors = mutableListOf<String>()

        var copiedFontBytes = 0L
        val maxSingleFontBytes = 64L * 1024L * 1024L
        val maxTotalFontBytes = 256L * 1024L * 1024L

        fontUris.forEachIndexed { index, uri ->
            try {
                var rawName = displayName(context, uri, "font_$index.ttf")
                if (!rawName.contains(Regex("\\.(ttf|otf|ttc|otc|woff2?)$", RegexOption.IGNORE_CASE))) {
                    rawName += ".ttf"
                }
                val target = File(fontsDir, index.toString().padStart(3, '0') + "_" + rawName)
                copyUriToFile(context, uri, target)

                val fontBytes = target.length()
                if (fontBytes > maxSingleFontBytes) {
                    target.delete()
                    throw IllegalStateException("字体文件超出单个上限 (64 MiB): $rawName")
                }
                if (copiedFontBytes + fontBytes > maxTotalFontBytes) {
                    target.delete()
                    throw IllegalStateException("本次任务字体总计超出上限 (256 MiB): $rawName")
                }

                copiedFontBytes += fontBytes
                resolvedPaths.add(target.absolutePath)
            } catch (e: Throwable) {
                accessErrors.add("URI [$uri]: ${e.message ?: e.javaClass.simpleName}")
            }
        }

        val extraDirs = if (fontsDir.listFiles()?.isNotEmpty() == true) {
            listOf(fontsDir.absolutePath)
        } else {
            emptyList()
        }

        val (allFontDirs, fallbackReady) = configureFonts(context, extraDirs)
        val fallbackCount = if (fallbackReady) 1 else 0

        val fallbackReason = when {
            selectedCount == 0 -> "No external fonts selected; using bundled Noto Sans SC fallback."
            resolvedPaths.isEmpty() -> "None of the $selectedCount selected fonts could be loaded (${accessErrors.joinToString("; ")}); falling back to bundled Noto Sans SC."
            resolvedPaths.size < selectedCount -> "Some selected fonts (${selectedCount - resolvedPaths.size}/$selectedCount) could not be accessed (${accessErrors.joinToString("; ")}); using ${resolvedPaths.size} loaded fonts and bundled fallback."
            else -> "All $selectedCount selected fonts loaded successfully; bundled Noto Sans SC available as fallback."
        }

        val result = FontPreparationResult(
            selectedCount = selectedCount,
            loadedCount = resolvedPaths.size,
            fallbackCount = fallbackCount,
            selectedUris = selectedUriStrings,
            resolvedPaths = resolvedPaths,
            passedToFFmpeg = allFontDirs,
            fallbackReason = fallbackReason,
            fallbackReady = fallbackReady,
            fontsDir = fontsDir
        )

        val logTag = "NativeJobStore"
        android.util.Log.i(logTag, "Selected fonts: ${result.selectedCount}")
        android.util.Log.i(logTag, "Loaded fonts: ${result.loadedCount}")
        android.util.Log.i(logTag, "Fallback fonts: ${result.fallbackCount}")
        android.util.Log.d(logTag, "Selected font URIs: ${result.selectedUris}")
        android.util.Log.d(logTag, "Resolved font paths: ${result.resolvedPaths}")
        android.util.Log.d(logTag, "Fonts passed to FFmpeg/libass: ${result.passedToFFmpeg}")
        android.util.Log.d(logTag, "Fallback reason: ${result.fallbackReason}")

        println("Selected fonts: ${result.selectedCount}")
        println("Loaded fonts: ${result.loadedCount}")
        println("Fallback fonts: ${result.fallbackCount}")

        return result
    }

    fun configureFonts(context: Context, extraDirectories: List<String> = emptyList()): Pair<List<String>, Boolean> {
        val fontDirs = mutableListOf<String>()

        extraDirectories
            .map(::File)
            .filter { it.isDirectory }
            .mapTo(fontDirs) { it.absolutePath }

        listOf("/system/fonts", "/product/fonts", "/system_ext/fonts").forEach { path ->
            if (File(path).isDirectory) fontDirs.add(path)
        }

        var fallbackReady = false
        try {
            val appFontDir = File(context.filesDir, "fonts")
            if (!appFontDir.exists()) appFontDir.mkdirs()
            val fallback = File(appFontDir, "NotoSansSC-Regular.otf")
            if (!fallback.exists() || fallback.length() == 0L) {
                context.assets.open("www/vendor/fallback-fonts/NotoSansSC-Regular.otf").use { input ->
                    fallback.outputStream().use { output -> input.copyTo(output) }
                }
            }
            if (fallback.isFile && fallback.length() > 0L) {
                fallbackReady = true
                fontDirs.add(appFontDir.absolutePath)
            }
        } catch (_: Throwable) {
            fallbackReady = false
        }

        val distinct = fontDirs.distinct()
        FFmpegKitConfig.setFontDirectoryList(
            context,
            distinct,
            emptyMap<String?, String?>()
        )
        return distinct to fallbackReady
    }

    fun escapeFilterPath(path: String): String =
        path
            .replace("\\", "\\\\")
            .replace(":", "\\:")
            .replace("'", "\\'")

    fun cleanupOldJobs(context: Context, maxAgeMs: Long = 7L * 24L * 60L * 60L * 1000L) {
        val root = File(context.filesDir, "jobs")
        if (!root.isDirectory) return
        val cutoff = System.currentTimeMillis() - maxAgeMs
        root.listFiles()?.forEach { dir ->
            if (dir.isDirectory && dir.lastModified() < cutoff) {
                try { dir.deleteRecursively() } catch (_: Throwable) {}
            }
        }
    }
}
