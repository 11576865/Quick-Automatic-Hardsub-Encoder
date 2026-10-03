package io.github.quickhardsub

import org.json.JSONObject
import com.arthenica.ffmpegkit.FFmpegKit

/** Accept only supported output options: never input URLs, output paths or commands. */
object MediaTaskArguments {
    private val values = mapOf(
        "-ss" to "0".toRegex(),
        "-map" to "0:(?:v:0|a\\?|a:\\d{1,2}|s\\?|t\\?)".toRegex(),
        "-c:v" to "copy|libx264|libx265|libsvtav1|h264_nvenc|hevc_nvenc|av1_nvenc".toRegex(),
        "-c:a" to "copy|aac|libopus".toRegex(),
        "-ac" to "\\d{1,2}".toRegex(),
        "-ar" to "\\d{4,6}".toRegex(),
        "-vsync" to "0|cfr|vfr".toRegex(),
        "-c:s" to "copy".toRegex(),
        "-c:t" to "copy".toRegex(),
        "-map_metadata" to "0|-1".toRegex(),
        "-map_chapters" to "0|-1".toRegex(),
        "-preset" to "ultrafast|superfast|veryfast|faster|fast|medium|slow|slower|veryslow|[0-9]|1[0-3]|p[1-7]".toRegex(),
        "-rc" to "vbr".toRegex(),
        "-b:v" to "\\d{1,10}".toRegex(),
        "-crf" to "\\d{1,2}(?:\\.\\d+)?".toRegex(),
        "-cq" to "\\d{1,2}(?:\\.\\d+)?".toRegex(),
        "-maxrate" to "\\d{1,10}".toRegex(),
        "-bufsize" to "\\d{1,10}".toRegex(),
        "-g" to "\\d{1,6}".toRegex(),
        "-bf" to "\\d{1,2}".toRegex(),
        "-refs" to "\\d{1,2}".toRegex(),
        "-threads" to "\\d{1,3}".toRegex(),
        "-r" to "\\d{1,6}(?:\\.\\d+)?(?:/\\d{1,6})?".toRegex(),
        "-fps_mode" to "passthrough|cfr|vfr".toRegex(),
        "-pix_fmt" to "yuv420p|yuv420p10le|yuv444p|yuv444p10le|p010le".toRegex(),
        "-profile:v" to "[A-Za-z0-9_.-]{1,40}".toRegex(),
        "-level:v" to "[A-Za-z0-9_.-]{1,40}".toRegex(),
        "-tune" to "[A-Za-z0-9_.-]{1,40}".toRegex(),
        "-multipass" to "disabled|qres|fullres".toRegex(),
        "-rc-lookahead" to "\\d{1,2}".toRegex(),
        "-spatial-aq" to "0|1".toRegex(),
        "-temporal-aq" to "0|1".toRegex(),
        "-aq-strength" to "\\d{1,2}".toRegex(),
        "-b:a" to "\\d{1,7}".toRegex(),
        "-frames:v" to "\\d{1,9}".toRegex(),
        "-x264-params" to "(?:rc-lookahead|aq-mode|aq-strength|qcomp|psy-rd|psy-rdoq|bframes|ref|keyint|min-keyint|scenecut|pools|frame-threads|lp|tune|film-grain|enable-overlays)=\\d+(?:\\.\\d+)?(?::(?:rc-lookahead|aq-mode|aq-strength|qcomp|psy-rd|psy-rdoq|bframes|ref|keyint|min-keyint|scenecut|pools|frame-threads|lp|tune|film-grain|enable-overlays)=\\d+(?:\\.\\d+)?)*".toRegex(),
        "-x265-params" to "(?:rc-lookahead|aq-mode|aq-strength|qcomp|psy-rd|psy-rdoq|bframes|ref|keyint|min-keyint|scenecut|pools|frame-threads|lp|tune|film-grain|enable-overlays)=\\d+(?:\\.\\d+)?(?::(?:rc-lookahead|aq-mode|aq-strength|qcomp|psy-rd|psy-rdoq|bframes|ref|keyint|min-keyint|scenecut|pools|frame-threads|lp|tune|film-grain|enable-overlays)=\\d+(?:\\.\\d+)?)*".toRegex(),
        "-svtav1-params" to "(?:rc-lookahead|aq-mode|aq-strength|qcomp|psy-rd|psy-rdoq|bframes|ref|keyint|min-keyint|scenecut|pools|frame-threads|lp|tune|film-grain|enable-overlays)=\\d+(?:\\.\\d+)?(?::(?:rc-lookahead|aq-mode|aq-strength|qcomp|psy-rd|psy-rdoq|bframes|ref|keyint|min-keyint|scenecut|pools|frame-threads|lp|tune|film-grain|enable-overlays)=\\d+(?:\\.\\d+)?)*".toRegex()
    )
    private val filters = listOf(
        "setpts=PTS[+-]\\d+(?:\\.\\d+)?/TB".toRegex(),
        "crop=\\d+:\\d+:\\d+:\\d+".toRegex(),
        "(?:bwdif|yadif)=mode=send_frame:parity=auto:deint=interlaced".toRegex(),
        "scale=(?:-2|\\d+):(?:-2|\\d+):flags=(?:bilinear|bicubic|lanczos|spline|neighbor)".toRegex(),
        "transpose=(?:clock|cclock)".toRegex(),
        "hflip|vflip|setsar=1|hqdn3d|deband|unsharp".toRegex(),
        "ass=__ASS__:fontsdir=__FONTS__".toRegex(),
        "pad=ceil\\(iw/2\\)\\*2:ceil\\(ih/2\\)\\*2:0:0".toRegex()
    )
    fun validate(task: JSONObject): List<String> {
        require(task.optInt("version") in 1..3) { "Unsupported media task version" }
        val operation = task.getString("operation")
        require(operation in setOf("copy", "transcode", "hardsub"))
        val outputFormat = task.optString("outputFormat", "")
        val outputExtension = task.optString("outputExtension", "")
        require(outputFormat in setOf("matroska", "mp4")) { "Unsupported output container format" }
        require(
            (outputFormat == "matroska" && outputExtension == "mkv") ||
                (outputFormat == "mp4" && outputExtension == "mp4")
        ) { "Output container format/extension mismatch" }
        val start = task.getDouble("start")
        val end = task.getDouble("end")
        require(start.isFinite() && end.isFinite() && start >= 0 && end > start)
        val array = task.getJSONArray("outputArgs")
        require(array.length() in 2..128)
        val result = mutableListOf<String>()
        val seen = mutableSetOf<String>()
        var i = 0
        while (i < array.length()) {
            val flag = array.getString(i++)
            require(flag == "-map" || seen.add(flag)) { "Duplicate output option" }
            result.add(flag)
            if (flag == "-sn") continue
            require(i < array.length())
            val value = array.getString(i++)
            require(value.length <= 2048)
            if (flag == "-vf") {
                require(operation != "copy")
                value.split(',').forEach { part -> require(filters.any { it.matches(part) }) { "Unsupported filter" } }
                require(value.contains("ass=__ASS__") == (operation == "hardsub"))
            } else require(values[flag]?.matches(value) == true) { "Unsupported output option: $flag" }
            if (flag == "-c:v") require((value == "copy") == (operation == "copy"))
            if (operation == "copy" && flag == "-c:a") require(value == "copy")
            if (flag == "-c:v") require(!value.endsWith("_nvenc")) { "NVENC is Windows only" }
            result.add(value)
        }
        require("-c:v" in seen)
        if (task.optBoolean("twoPass")) require(result[result.indexOf("-c:v") + 1] == "libx264" && "-b:v" in result) { "Two-pass requires x264 bitrate mode" }
        return result
    }

    fun hardsubReferenceFilter(
        task: JSONObject,
        sourceTime: Double,
        assPath: String,
        fontsDir: String,
        displayWidth: Int
    ): String {
        require(task.optString("operation") == "hardsub") { "Reference frame requires hardsub task" }
        require(sourceTime.isFinite() && sourceTime >= 0.0) { "Invalid reference timestamp" }
        val validated = validate(task)
        val vfIndex = validated.indexOf("-vf")
        require(vfIndex >= 0 && vfIndex + 1 < validated.size) { "Hardsub task has no video filter chain" }
        val absolute = String.format(java.util.Locale.US, "%.6f", sourceTime).trimEnd('0').trimEnd('.')
        val out = mutableListOf<String>()
        var foundAss = false
        validated[vfIndex + 1].split(',').forEach { raw ->
            val part = raw.trim()
            if (Regex("^setpts=PTS[+-]\\d+(?:\\.\\d+)?/TB$").matches(part)) return@forEach
            if (part == "ass=__ASS__:fontsdir=__FONTS__") {
                foundAss = true
                out.add("setpts=PTS-STARTPTS+$absolute/TB")
                out.add("ass=$assPath:fontsdir=$fontsDir")
                out.add("setpts=PTS-STARTPTS")
            } else {
                out.add(part)
            }
        }
        require(foundAss) { "Hardsub task filter chain has no ASS step" }
        val width = displayWidth.coerceIn(320, 1600)
        out.add("scale=$width:-2:force_original_aspect_ratio=decrease")
        return out.joinToString(",")
    }

    fun firstPassArgs(args: List<String>): List<String> {
        val out = mutableListOf<String>()
        var i = 0
        while (i < args.size) {
            val flag = args[i++]
            if (flag == "-sn") continue
            val value = args[i++]
            if (flag in setOf("-c:a", "-b:a", "-ac", "-ar", "-c:s", "-c:t", "-map_metadata", "-map_chapters")) continue
            if (flag == "-map" && !value.startsWith("0:v:")) continue
            out.addAll(listOf(flag, value))
        }
        return out + listOf("-an", "-sn")
    }
    private val helpCache = mutableMapOf<String, String>()
    @Synchronized private fun help(key: String): String = helpCache.getOrPut(key) {
        FFmpegKit.executeWithArguments(if (key == "full") arrayOf("-hide_banner", "-h", "full") else arrayOf("-hide_banner", "-h", "encoder=$key")).getOutput().orEmpty()
    }
    fun supportsFpsMode(): Boolean = Regex("(?m)^\\s*-fps_mode(?:\\s|$)").containsMatchIn(help("full"))
    fun validateSupport(args: List<String>) {
        val encoder = args[args.indexOf("-c:v") + 1]
        if (encoder == "copy") return
        if ("-c:a" in args) {
            val audio = args[args.indexOf("-c:a") + 1]
            if (audio != "copy") require(help(audio).contains("Encoder $audio ")) { "Audio encoder is unavailable" }
        }
        val encoderHelp = help(encoder)
        val options = Regex("(?m)^\\s*(-[A-Za-z0-9_:.-]+)(?:\\s|$)").findAll(help("full") + "\n" + encoderHelp).map { it.groupValues[1] }.toSet()
        require(options.isNotEmpty()) { "Unable to inspect FFmpeg capabilities" }
        for (flag in listOf("-fps_mode", "-vsync", "-crf", "-preset", "-tune")) require(flag !in args || flag in options) { "FFmpeg does not support $flag" }
        val formats = Regex("Supported pixel formats:\\s*([^\\r\\n]+)").find(encoderHelp)?.groupValues?.get(1)?.trim()?.split(Regex("\\s+"))
        if (!formats.isNullOrEmpty() && "-pix_fmt" in args) require(args[args.indexOf("-pix_fmt") + 1] in formats) { "Unsupported encoder pixel format" }
    }
}
