# Broke Guest Manager for OpenRCT2

A comprehensive OpenRCT2 plugin that helps manage guests who have run out of money or can't afford park attractions, with advanced park rating protection to prevent negative impacts on your park's reputation.

![OpenRCT2](https://img.shields.io/badge/OpenRCT2-Compatible-green)
![Version](https://img.shields.io/badge/version-12.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-yellow)

## 🎯 Features

### 🏠 Guest Management
- **Automatic Detection**: Identifies guests with $0 (broke) and guests who can't afford any rides
- **Custom Thresholds**: Set your own money threshold for guest management
- **Flexible Sending Options**: Choose between normal departure (guests walk to exit) or instant deletion
- **Separate Controls**: Different buttons for broke guests vs. guests who can't afford rides
- **Auto-Send Mode**: Automatically send qualifying guests home at configurable intervals
- **Settings Persistence**: Settings survive plugin reloads via OpenRCT2 shared storage

### 📊 Smart Analytics
- **Real-Time Counters**: Track broke guests, guests who can't afford rides, and departure statistics
- **Currency Detection**: Automatically detects and displays your park's currency symbol and scale
- **Accurate Tracking**: Deduplication prevents double-counting across guest lists
- **Configurable Updates**: Set departure tracking interval (5-300s) and auto-send interval (1-60s)

### 🛡️ Advanced Park Rating Protection
- **Pre-emptive Happiness Boosting**: Leaving guests get happiness boosted before departure
- **Continuous Monitoring**: All departing guests are tracked and maintained
- **Emergency Override**: Cheat mode activation for severe rating drops with automatic 30-second cleanup
- **Happiness-Based Fallback**: Works even when direct park rating access isn't available

### ⚙️ Advanced Configuration
- **Custom Money Thresholds**: Set specific cash amounts below which guests are considered for removal
- **Configurable Intervals**: Independent settings for departure tracking and auto-send frequency
- **Instant Delete Mode**: Instantly remove guests instead of making them walk to exit
- **Rating Protection Toggle**: Enable/disable park rating protection (on by default, persists across sessions)

## 📦 Installation

1. **Download** the latest `broke-guest-manager.js` file
2. **Place** it in your OpenRCT2 plugin directory:
   - **Windows**: `%USERPROFILE%\Documents\OpenRCT2\plugin\`
   - **macOS**: `~/Documents/OpenRCT2/plugin/`
   - **Linux**: `~/.config/OpenRCT2/plugin/`
3. **Restart** OpenRCT2 or reload plugins
4. **Access** via the "Broke Guest Manager" menu item

## 🚀 Quick Start

### Basic Usage
1. Open your park in OpenRCT2
2. Click "Broke Guest Manager" in the menu
3. The main window shows:
   - Current count of broke guests and guests who can't afford rides
   - Cheapest ride price (used as threshold)
   - Guest departure statistics

### Sending Guests Home
- **Send Broke**: Removes guests with $0
- **Send Cant Afford**: Removes guests who can't afford the cheapest ride
- **Send All**: Removes all qualifying guests
- **Advanced**: Opens detailed settings

### Advanced Settings
- **Custom Threshold**: Set a specific money amount instead of using cheapest ride price
- **Instant Delete**: Remove guests immediately vs. making them walk to exit
- **Rating Protection**: Enable/disable park rating protection (recommended: keep enabled)
- **Departure Tracking Interval**: How often departure statistics are refreshed
- **Auto-Send Interval**: How frequently auto-send checks for qualifying guests

## 🛡️ Park Rating Protection

This plugin includes a rating protection system that prevents your park rating from dropping when guests leave:

### How It Works
1. **Pre-emptive Protection**: Guest happiness is boosted before they're sent home
2. **Continuous Monitoring**: All departing guests are monitored and their happiness maintained
3. **Emergency Measures**: For severe rating drops (>100 points), cheat protection activates temporarily and auto-cleans after 30 seconds
4. **Happiness Fallback**: If direct park rating isn't accessible, a periodic happiness boost runs instead

### Console Messages
When rating protection is active, you'll see messages like:
```
Broke Guest Manager: Rating protection enabled. Baseline: 967
Broke Guest Manager: Sent guest 1234 home (cash: $0.00) [rating protected]
Broke Guest Manager: Boosted 15/20 leaving guests to happiness 240
```

## 🔧 Advanced Features

### Custom Thresholds
Instead of using the cheapest ride price, you can set a custom money threshold:
1. Open **Advanced Settings**
2. Check **"Use custom threshold"**
3. Enter your desired amount (e.g., 10)
4. All guests below this amount will be considered for removal

### Auto-Send Mode
Enable automatic guest management:
1. Check **"Auto-send broke"** or **"Auto-send cant afford"**
2. The plugin automatically sends qualifying guests home at the configured interval
3. Configure the auto-send interval in Advanced Settings (default: 5000ms)

### Settings Persistence
Settings are saved via OpenRCT2's shared storage and survive plugin reloads:
- Custom threshold value
- Instant delete mode
- Departure tracking interval
- Auto-send interval
- Rating protection toggle

## 🐛 Troubleshooting

**Rating protection not working:**
1. Check console for "Rating protection enabled" message
2. Verify guests are being happiness-boosted in the logs
3. Enable cheats in OpenRCT2 for the emergency override to work

**Plugin not appearing in menu:**
1. Ensure file is in correct plugin directory
2. Check file extension is `.js`
3. Restart OpenRCT2 completely

**Currency display issues:**
1. Plugin auto-detects currency scale and symbol
2. Falls back to `$` symbol if detection fails
3. Scale detection handles pence/cents correctly

## ⚠️ Important Notes

### Performance
- Guest scans run when you click buttons or on the auto-send interval
- Departure tracking updates at the configured interval (default 30s)
- Instant delete mode is more performance-friendly than normal mode

### Rating Protection
- Works by manipulating guest happiness, not directly modifying park rating
- Emergency cheat mode requires cheats to be enabled
- Protection effectiveness may vary based on OpenRCT2 version

### Save Game Compatibility
- Plugin state is not saved with your park
- Settings survive plugin reloads via shared storage but reset on game restart
- No permanent changes are made to your save files

## 📜 License

MIT License - see LICENSE file for details.

## 🙏 Acknowledgments

- OpenRCT2 development team for the plugin API
- OpenRCT2 community for testing and feedback

---

**Made for OpenRCT2 with ❤️**
