package io.github.quickhardsub

import android.content.Context
import java.io.File

object NativeSampleStore {
    private val SAFE_ID = Regex("^[a-f0-9-]{16,64}$")

    fun isSafeId(sampleId: String): Boolean = SAFE_ID.matches(sampleId)

    fun root(context: Context): File =
        File(context.cacheDir, "native-samples")

    fun file(context: Context, sampleId: String): File {
        require(isSafeId(sampleId)) { "invalid sample id" }
        return File(root(context), sampleId + ".mkv")
    }

    fun cleanup(context: Context, keepId: String? = null) {
        val dir = root(context)
        if (!dir.isDirectory) return
        dir.listFiles()?.forEach { file ->
            if (keepId == null || file.nameWithoutExtension != keepId) {
                try { file.delete() } catch (_: Throwable) {}
            }
        }
    }
}
