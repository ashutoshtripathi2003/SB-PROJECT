package com.ridesync.ridesync

import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import android.os.Bundle
import io.flutter.embedding.android.FlutterActivity

class MainActivity : FlutterActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // "Ride updates" channel: high importance so they pop up like Ola / Uber notifications.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel("rides", "Ride updates", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Requests, driver on the way, arrivals, payments and reminders"
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }
}
