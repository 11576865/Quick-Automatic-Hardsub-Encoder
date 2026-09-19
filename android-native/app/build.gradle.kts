plugins {
    id("com.android.application")
    kotlin("android")
}

android {
    namespace = "io.github.quickhardsub"
    compileSdk = 35

    defaultConfig {
        applicationId = "io.github.quickhardsub"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0-native"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    packaging {
        jniLibs {
            useLegacyPackaging = false
        }
    }
}

dependencies {
    implementation("com.arthenica:ffmpeg-kit-next:9.0.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
}
