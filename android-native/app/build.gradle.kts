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
        versionCode = 2
        versionName = "0.2.0-native"
    }

    buildFeatures {
        buildConfig = true
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
