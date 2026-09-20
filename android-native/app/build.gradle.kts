plugins {
    id("com.android.application")
    kotlin("android")
}

val ciVersionCode = providers.environmentVariable("APP_VERSION_CODE").orNull?.toIntOrNull()
val ciVersionName = providers.environmentVariable("APP_VERSION_NAME").orNull

android {
    namespace = "io.github.quickhardsub"
    compileSdk = 35

    defaultConfig {
        applicationId = "io.github.quickhardsub"
        minSdk = 24
        targetSdk = 35
        versionCode = ciVersionCode ?: 3
        versionName = ciVersionName ?: "0.2.1-native"
    }

    buildFeatures {
        buildConfig = true
    }

    signingConfigs {
        getByName("debug") {
            val ciKey = rootProject.file("../.ci-signing/debug.keystore")
            if (ciKey.isFile) {
                storeFile = ciKey
                storePassword = "android"
                keyAlias = "androiddebugkey"
                keyPassword = "android"
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        jniLibs {
            useLegacyPackaging = false
        }
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    implementation("com.arthenica:ffmpeg-kit-next:9.0.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
}
