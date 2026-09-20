package io.github.quickhardsub

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

object NativeBenchmarkStore {
    private const val SCHEMA_VERSION = 1
    private const val MAX_RECORDS = 200
    private val lock = Any()

    private fun historyFile(context: Context): File =
        File(context.filesDir, "benchmarks/history-v1.json")

    private fun emptyRoot(): JSONObject =
        JSONObject()
            .put("schemaVersion", SCHEMA_VERSION)
            .put("records", JSONArray())

    private fun readRootLocked(context: Context): JSONObject {
        val file = historyFile(context)
        if (!file.isFile) return emptyRoot()
        return try {
            val root = JSONObject(file.readText(Charsets.UTF_8))
            if (root.optInt("schemaVersion", -1) != SCHEMA_VERSION) emptyRoot()
            else root
        } catch (_: Throwable) {
            try {
                val backup = File(
                    file.parentFile,
                    "history-v1.corrupt-" + System.currentTimeMillis() + ".json"
                )
                file.copyTo(backup, overwrite = false)
            } catch (_: Throwable) {}
            emptyRoot()
        }
    }

    private fun writeRootLocked(context: Context, root: JSONObject) {
        val file = historyFile(context)
        file.parentFile?.mkdirs()
        val tmp = File(file.parentFile, file.name + ".tmp")
        tmp.writeText(root.toString(), Charsets.UTF_8)
        if (!tmp.renameTo(file)) {
            file.writeText(root.toString(), Charsets.UTF_8)
            tmp.delete()
        }
    }

    fun appendSuccess(context: Context, record: JSONObject) {
        synchronized(lock) {
            val root = readRootLocked(context)
            val old = root.optJSONArray("records") ?: JSONArray()
            val trimmed = JSONArray()
            val start = maxOf(0, old.length() - (MAX_RECORDS - 1))
            for (i in start until old.length()) {
                trimmed.put(old.optJSONObject(i) ?: continue)
            }

            record
                .put("schemaVersion", SCHEMA_VERSION)
                .put("recordedAt", System.currentTimeMillis())
            trimmed.put(record)

            writeRootLocked(
                context,
                JSONObject()
                    .put("schemaVersion", SCHEMA_VERSION)
                    .put("records", trimmed)
            )
        }
    }

    fun snapshot(context: Context): JSONObject =
        synchronized(lock) {
            val root = readRootLocked(context)
            val records = root.optJSONArray("records") ?: JSONArray()
            JSONObject()
                .put("schemaVersion", SCHEMA_VERSION)
                .put("count", records.length())
                .put("records", records)
        }

    fun clear(context: Context) {
        synchronized(lock) {
            writeRootLocked(context, emptyRoot())
        }
    }
}
