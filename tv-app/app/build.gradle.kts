plugins {
    id("com.android.application")
}

android {
    namespace = "tv.channeldock.player"
    compileSdk = 36

    defaultConfig {
        applicationId = "tv.channeldock.player"
        minSdk = 28
        targetSdk = 36
        versionCode = 11
        versionName = "0.9.0"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.media3:media3-exoplayer:1.11.1")
    implementation("androidx.media3:media3-ui:1.11.1")
}
