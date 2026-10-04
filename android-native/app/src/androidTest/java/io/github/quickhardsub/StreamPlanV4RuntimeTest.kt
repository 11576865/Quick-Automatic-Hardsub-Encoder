package io.github.quickhardsub

import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class StreamPlanV4RuntimeTest {
    private fun readAsset(name: String): String {
        val assets = InstrumentationRegistry.getInstrumentation().context.assets
        return assets.open(name).bufferedReader(Charsets.UTF_8).use { it.readText() }
    }

    private fun copyAsset(name: String, target: File) {
        val assets = InstrumentationRegistry.getInstrumentation().context.assets
        target.parentFile?.mkdirs()
        assets.open(name).use { input ->
            target.outputStream().use { output -> input.copyTo(output, 1024 * 1024) }
        }
    }

    private fun stageBundledFallback(context: android.content.Context) {
        val appFontDir = File(context.filesDir, "fonts")
        assertTrue("could not create app fallback font directory", appFontDir.mkdirs() || appFontDir.isDirectory)
        val fallback = File(appFontDir, "NotoSansSC-Regular.otf")
        context.assets.open("www/vendor/fallback-fonts/NotoSansSC-Regular.otf").use { input ->
            fallback.outputStream().use { output -> input.copyTo(output, 1024 * 1024) }
        }
        assertTrue("bundled fallback font was not packaged into the target APK", fallback.isFile && fallback.length() > 0L)
    }

    private fun waitForIdle(timeoutMs: Long = 30_000L) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (EncodeService.isEncoding() && System.currentTimeMillis() < deadline) {
            Thread.sleep(100)
        }
        assertTrue("previous EncodeService job did not become idle", !EncodeService.isEncoding())
    }

    @Test
    fun executesAllStreamPlanV4CasesThroughEncodeService() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        // The product UI normally completes its native self-test before task execution.
        // This runtime harness enters EncodeService directly, so establish the same
        // packaged-font precondition deterministically instead of racing WebView bootstrap.
        stageBundledFallback(context)

        val scenario = ActivityScenario.launch(MainActivity::class.java)
        try {
        val source = File(context.cacheDir, "stream-plan-v4-source.mkv")
        copyAsset("stream-plan-v4-source.mkv", source)
        assertTrue("fixture source was not staged", source.isFile && source.length() > 0)

        val suite = JSONObject(readAsset("stream-plan-v4-runtime-requests.json"))
        assertEquals(4, suite.getInt("taskSchemaVersion"))
        val burnAss = readAsset("burn.ass")
        val cases = suite.getJSONArray("cases")
        assertEquals("device acceptance suite changed unexpectedly", 8, cases.length())

        val evidenceDir = File(context.filesDir, "device-acceptance-outputs")
        evidenceDir.deleteRecursively()
        assertTrue("could not create evidence output directory", evidenceDir.mkdirs() || evidenceDir.isDirectory)

        for (i in 0 until cases.length()) {
            waitForIdle()
            val testCase = cases.getJSONObject(i)
            val id = testCase.getString("id")
            val outputName = testCase.getString("output")
            val body = testCase.getJSONObject("body")
            val incoming = body.getJSONObject("request")
            val task = JSONObject(incoming.getJSONObject("task").toString())

            assertEquals("$id task schema version", 4, task.getInt("version"))
            MediaTaskArguments.validate(task)

            val jobId = UUID.randomUUID().toString()
            val jobDir = NativeJobStore.jobDir(context, jobId)
            assertTrue("$id could not create job directory", jobDir.mkdirs() || jobDir.isDirectory)

            val operation = task.getString("operation")
            NativeJobStore.assFile(context, jobId).writeText(
                if (operation == "hardsub") burnAss else "",
                Charsets.UTF_8
            )

            val primary = task.optJSONArray("videoStreams")?.optInt(0, 0) ?: 0
            val request = JSONObject()
                .put("task", task)
                .put("inputUri", Uri.fromFile(source).toString())
                .put("fontUris", JSONArray())
                .put("codec", task.optString("codec", "h264"))
                .put("mode", task.optString("rateMode", "quality"))
                .put("preset", task.optString("preset", "ultrafast"))
                .put("crf", task.optInt("quality", 30))
                .put("targetVideoBitrate", task.optLong("bitrate", 0L))
                .put("expectedDuration", task.optDouble("expectedDuration", 6.0))
                .put("expectedAudioTracks", task.optInt("expectedAudioTracks", 0))
                .put("estimatedOutputBytes", 64L * 1024L * 1024L)
                .put("goal", "device-acceptance")
                .put("subtitleEventCount", if (operation == "hardsub") 1 else 0)
                .put("selectedFontCount", 0)
                .put("sampleEncodeSpeed", 0.0)
                .put("calibrationSampleBitrate", 0L)
                .put("sourceIdentity", "stream-plan-v4-emulator|video=$primary")
                .put("sourceCodec", "h264")
                .put("sourcePixelFormat", "yuv420p")
                .put("sourceWidth", if (primary == 1) 240 else 320)
                .put("sourceHeight", if (primary == 1) 136 else 180)
                .put("sourceFps", if (primary == 1) 24.0 else 30.0)
                .put("sourceVideoBitrate", 0L)
                .put("suggestedName", outputName)

            NativeJobStore.writeJsonAtomic(NativeJobStore.requestFile(context, jobId), request)
            NativeJobStore.writeStatus(
                context,
                jobId,
                JSONObject()
                    .put("state", "queued")
                    .put("message", "Android emulator Stream Plan v4 acceptance")
                    .put("progress", 0.0)
                    .put("suggestedName", outputName)
            )

            val intent = Intent(context, EncodeService::class.java).apply {
                action = EncodeService.ACTION_START
                putExtra(EncodeService.EXTRA_JOB_ID, jobId)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }

            val deadline = System.currentTimeMillis() + 180_000L
            var terminal: JSONObject? = null
            while (System.currentTimeMillis() < deadline) {
                Thread.sleep(250)
                val status = NativeJobStore.readStatus(context, jobId) ?: continue
                when (status.optString("state")) {
                    "completed", "failed", "cancelled" -> {
                        terminal = status
                        break
                    }
                }
            }
            assertNotNull("$id timed out waiting for EncodeService", terminal)
            val terminalMessage = terminal?.optString("error", terminal?.optString("message", "")) ?: ""
            assertEquals(
                id + " Android EncodeService failed: " + terminalMessage,
                "completed",
                terminal?.optString("state")
            )

            val produced = NativeJobStore.outputFile(context, jobId)
            assertTrue("$id output is missing", produced.isFile && produced.length() > 0)
            produced.copyTo(File(evidenceDir, outputName), overwrite = true)
        }

        waitForIdle()
        val exported = evidenceDir.listFiles()?.filter { it.isFile } ?: emptyList()
        assertEquals("not all runtime outputs were preserved for host verification", 8, exported.size)
        } finally {
            scenario.close()
        }
    }
}
