/**
 * Broke Guest Manager for OpenRCT2
 * Manages guests who have run out of money or can't afford park attractions,
 * with advanced park rating protection to prevent negative impacts on your park.
 */

var main = function() {
    if (typeof ui === 'undefined') {
        console.log('Broke Guest Manager: UI not available');
        return;
    }

    // ── Constants ──────────────────────────────────────────────────────────
    var PLUGIN_VERSION = '12.0.0';
    var CLASSIFICATION = 'broke-guest-manager-v12';
    var ADVANCED_CLASSIFICATION = 'broke-guest-advanced-v12';

    // ── State ──────────────────────────────────────────────────────────────
    var autoSendHome = false;
    var autoSendCantAfford = false;
    var brokeGuestWindow = null;
    var advancedWindow = null;
    var updateInterval = null;

    // Advanced settings
    var customMoneyThreshold = null;
    var instantDelete = false;
    var departureTrackingInterval = 30; // seconds between departure updates
    var autoSendInterval = 5000; // ms between auto-send passes
    var protectParkRating = true;

    // Counter system
    var guestsActuallyLeft = 0;
    var guestsSentButStillWalking = {};
    var lastDepartureUpdate = 0;
    var debugLogCounter = 0;

    // Rating protection system
    var baselineParkRating = null;
    var ratingProtectionInterval = null;
    var ratingProtectionActive = false;

    // ── Persistence ────────────────────────────────────────────────────────
    function saveSettings() {
        try {
            if (typeof context !== 'undefined' && context.sharedStorage) {
                context.sharedStorage.set('broke-guest-manager-settings', {
                    customMoneyThreshold: customMoneyThreshold,
                    instantDelete: instantDelete,
                    departureTrackingInterval: departureTrackingInterval,
                    autoSendInterval: autoSendInterval,
                    protectParkRating: protectParkRating
                });
            }
        } catch (e) {
            // sharedStorage not available in all OpenRCT2 builds
        }
    }

    function loadSettings() {
        try {
            if (typeof context !== 'undefined' && context.sharedStorage) {
                var saved = context.sharedStorage.get('broke-guest-manager-settings', null);
                if (saved) {
                    customMoneyThreshold = saved.customMoneyThreshold !== undefined ? saved.customMoneyThreshold : null;
                    instantDelete = saved.instantDelete || false;
                    departureTrackingInterval = saved.departureTrackingInterval || 30;
                    autoSendInterval = saved.autoSendInterval || 5000;
                    protectParkRating = saved.protectParkRating !== undefined ? saved.protectParkRating : true;
                }
            }
        } catch (e) {
            // sharedStorage not available
        }
    }

    // Load persisted settings on startup
    loadSettings();

    // ── Utilities ──────────────────────────────────────────────────────────

    function formatCurrency(amount) {
        try {
            return context.formatString('{CURRENCY}', amount);
        } catch (error) {
            return '$' + amount.toFixed(2);
        }
    }

    function getCurrencySymbol() {
        try {
            var formatted = formatCurrency(0);
            return formatted.replace(/[\d.,\s]/g, '');
        } catch (error) {
            return '$';
        }
    }

    // Deduplicate two arrays of guests by ID
    function dedupeGuests(arr1, arr2) {
        if (!arr2 || arr2.length === 0) return arr1.slice();
        var combined = arr1.concat(arr2);
        var seen = {};
        return combined.filter(function(guest) {
            if (seen[guest.id]) return false;
            seen[guest.id] = true;
            return true;
        });
    }

    /** Throttled debug logging — emits roughly every Nth call */
    function debugLog(msg) {
        debugLogCounter++;
        if (debugLogCounter % 10 === 0) {
            console.log(msg);
        }
    }

    // ── Currency Detection ─────────────────────────────────────────────────

    var currencyScale = (function() {
        try {
            var testAmount = 10;
            var formatted = formatCurrency(testAmount);
            var numericPart = parseFloat(formatted.replace(/[^\d.,]/g, ''));
            if (!isNaN(numericPart)) {
                if (numericPart >= 0.09 && numericPart <= 0.11) return 100;
                if (numericPart >= 0.9 && numericPart <= 1.1) return 10;
                if (numericPart >= 9 && numericPart <= 11) return 1;
            }
        } catch (e) {}
        return 10; // Default: most common scale
    })();

    function displayToInternal(displayAmount) {
        return Math.round(displayAmount * currencyScale);
    }

    function internalToDisplay(internalAmount) {
        return internalAmount / currencyScale;
    }

    // ── Ride Analysis ──────────────────────────────────────────────────────

    var cachedCheapestRidePrice = null;
    var cachedCheapestRideTime = 0;

    function getCheapestRidePrice() {
        var now = Date.now();
        if (cachedCheapestRidePrice !== null && (now - cachedCheapestRideTime) < 3000) {
            return cachedCheapestRidePrice;
        }
        try {
            var rides = map.rides.filter(function(ride) {
                return ride.classification === 'ride' &&
                       ride.status === 'open' &&
                       ride.price && ride.price[0] > 0;
            });
            if (rides.length === 0) return 0;
            var cheapest = rides[0];
            for (var i = 1; i < rides.length; i++) {
                if (rides[i].price[0] < cheapest.price[0]) {
                    cheapest = rides[i];
                }
            }
            cachedCheapestRidePrice = cheapest.price[0];
            cachedCheapestRideTime = now;
            return cachedCheapestRidePrice;
        } catch (e) {
            return 0;
        }
    }

    function hasAnyPaidRides() {
        return getCheapestRidePrice() > 0;
    }

    function getMoneyThreshold() {
        if (customMoneyThreshold !== null) {
            return displayToInternal(customMoneyThreshold);
        }
        return getCheapestRidePrice();
    }

    // ── Guest Detection ────────────────────────────────────────────────────

    function getBrokeGuests() {
        var allGuests = map.getAllEntities('guest');
        return allGuests.filter(function(guest) {
            return guest.cash <= 0 && guest.isInPark;
        });
    }

    function getCantAffordGuests() {
        var threshold = getMoneyThreshold();
        if (threshold === 0) return [];
        var allGuests = map.getAllEntities('guest');

        if (customMoneyThreshold !== null) {
            // Custom mode: all guests below threshold (including $0)
            return allGuests.filter(function(guest) {
                return guest.cash < threshold && guest.isInPark;
            });
        }
        // Normal mode: only guests with some money who still can't afford rides
        return allGuests.filter(function(guest) {
            return guest.cash < threshold && guest.cash > 0 && guest.isInPark;
        });
    }

    function getGuestsAlreadyLeaving() {
        var allGuests = map.getAllEntities('guest');
        var leavingGuests = [];
        for (var i = 0; i < allGuests.length; i++) {
            var guest = allGuests[i];
            try {
                if (guest.getFlag && guest.getFlag('leavingPark') && guest.isInPark) {
                    leavingGuests.push(guest);
                }
            } catch (e) {
                if (guestsSentButStillWalking[guest.id] && guest.isInPark) {
                    leavingGuests.push(guest);
                }
            }
        }
        return leavingGuests;
    }

    function getAllTargetGuests() {
        if (customMoneyThreshold !== null) {
            return getCantAffordGuests();
        }
        return dedupeGuests(getBrokeGuests(), getCantAffordGuests());
    }

    // ── Guest Sending (unified) ────────────────────────────────────────────

    function getTargetGuestsForMode(mode) {
        var targetGuests;
        if (mode === 'broke') {
            targetGuests = customMoneyThreshold !== null ? getCantAffordGuests() : getBrokeGuests();
        } else if (mode === 'cantafford') {
            targetGuests = getCantAffordGuests();
        } else {
            targetGuests = getAllTargetGuests();
        }

        // In instant-delete mode, also include guests already leaving
        if (instantDelete) {
            var leavingFilter = mode === 'broke' && customMoneyThreshold === null
                ? getGuestsAlreadyLeaving().filter(function(g) { return g.cash <= 0; })
                : getGuestsAlreadyLeaving();
            targetGuests = dedupeGuests(targetGuests, leavingFilter);
        }
        return targetGuests;
    }

    function sendGuestsHome(mode) {
        var targetGuests = getTargetGuestsForMode(mode);
        var sentCount = 0;
        var threshold = getMoneyThreshold();

        console.log('Broke Guest Manager: Processing ' + targetGuests.length + ' target guests (mode: ' + mode + ')');

        for (var i = 0; i < targetGuests.length; i++) {
            var guest = targetGuests[i];
            if (instantDelete || !guestsSentButStillWalking[guest.id]) {
                sendGuestHome(guest);
                sentCount++;
            }
        }

        if (sentCount > 0 && protectParkRating) {
            boostLeavingGuestHappiness();
        }

        var label = customMoneyThreshold !== null
            ? ' below ' + formatCurrency(displayToInternal(customMoneyThreshold))
            : '';
        console.log('Broke Guest Manager: Sent ' + sentCount + ' guests home' + label + ' (' + targetGuests.length + ' total found)');
    }

    function sendGuestHome(guest) {
        try {
            if (instantDelete) {
                guest.remove();
                guestsActuallyLeft++;
                if (guestsSentButStillWalking[guest.id]) {
                    delete guestsSentButStillWalking[guest.id];
                }
                console.log('Broke Guest Manager: Instantly deleted guest ' + guest.id + ' (cash: ' + formatCurrency(guest.cash) + ')');
            } else {
                if (guestsSentButStillWalking[guest.id]) {
                    return; // Already sent
                }
                // Pre-boost happiness before setting leaving flag
                if (protectParkRating && guest.happiness < 240) {
                    guest.happiness = 240;
                }
                guest.setFlag('leavingPark', true);
                guestsSentButStillWalking[guest.id] = true;
                console.log('Broke Guest Manager: Sent guest ' + guest.id + ' home (cash: ' + formatCurrency(guest.cash) + ')' +
                           (protectParkRating ? ' [rating protected]' : ''));
            }
        } catch (error) {
            console.log('Broke Guest Manager: Error sending guest home: ' + error);
        }
    }

    // ── Departure Tracking ─────────────────────────────────────────────────

    function updateGuestDepartureTracking() {
        var currentTime = Date.now();
        if (currentTime - lastDepartureUpdate < (departureTrackingInterval * 1000)) {
            return;
        }
        lastDepartureUpdate = currentTime;

        var currentGuestIds = {};
        var allGuests = map.getAllEntities('guest');
        for (var i = 0; i < allGuests.length; i++) {
            currentGuestIds[allGuests[i].id] = true;
        }

        for (var guestId in guestsSentButStillWalking) {
            if (!currentGuestIds[parseInt(guestId, 10)]) {
                guestsActuallyLeft++;
                delete guestsSentButStillWalking[guestId];
            }
        }
    }

    function getStillWalkingCount() {
        var count = 0;
        for (var id in guestsSentButStillWalking) {
            if (guestsSentButStillWalking.hasOwnProperty(id)) count++;
        }
        return count;
    }

    function resetCounter() {
        guestsActuallyLeft = 0;
        guestsSentButStillWalking = {};
        lastDepartureUpdate = 0;
        if (protectParkRating) {
            var currentRating = getParkRating();
            if (currentRating !== null) {
                baselineParkRating = currentRating;
            }
        }
        console.log('Broke Guest Manager: Counter reset' + (baselineParkRating !== null ? ', rating baseline: ' + baselineParkRating : ''));
    }

    // ── Park Rating Protection (unified) ───────────────────────────────────

    function getParkRating() {
        try {
            if (typeof park !== 'undefined' && park && typeof park.rating !== 'undefined') {
                return park.rating;
            }
            if (typeof context !== 'undefined' && context && context.park && typeof context.park.rating !== 'undefined') {
                return context.park.rating;
            }
            if (typeof scenario !== 'undefined' && scenario && typeof scenario.parkRating !== 'undefined') {
                return scenario.parkRating;
            }
            return null;
        } catch (error) {
            return null;
        }
    }

    function boostLeavingGuestHappiness(threshold) {
        var minHappiness = threshold || 240;
        var allGuests = map.getAllEntities('guest');
        var boostedCount = 0;
        var leavingCount = 0;

        for (var i = 0; i < allGuests.length; i++) {
            var guest = allGuests[i];
            try {
                var isLeaving = false;
                if (guest.getFlag) {
                    isLeaving = guest.getFlag('leavingPark') && guest.isInPark;
                } else if (guestsSentButStillWalking[guest.id] && guest.isInPark) {
                    isLeaving = true;
                }
                if (isLeaving) {
                    leavingCount++;
                    if (guest.happiness < minHappiness) {
                        guest.happiness = minHappiness;
                        boostedCount++;
                    }
                    // Also boost energy/hunger/thirst
                    try {
                        if (typeof guest.energy !== 'undefined' && guest.energy < 200) guest.energy = 200;
                        if (typeof guest.hunger !== 'undefined' && guest.hunger > 50) guest.hunger = 50;
                        if (typeof guest.thirst !== 'undefined' && guest.thirst > 50) guest.thirst = 50;
                    } catch (e) {}
                }
            } catch (e) {}
        }

        if (boostedCount > 0) {
            console.log('Broke Guest Manager: Boosted ' + boostedCount + '/' + leavingCount + ' leaving guests to happiness ' + minHappiness);
        }
        return { leavingCount: leavingCount, boostedCount: boostedCount };
    }

    function initializeRatingProtection() {
        if (protectParkRating && !ratingProtectionInterval) {
            var parkRating = getParkRating();
            if (parkRating !== null) {
                baselineParkRating = parkRating;
                ratingProtectionActive = true;
                console.log('Broke Guest Manager: Rating protection enabled. Baseline: ' + baselineParkRating);
                ratingProtectionInterval = context.setInterval(function() {
                    maintainParkRating();
                }, 3000);
            } else {
                console.log('Broke Guest Manager: Park rating not directly accessible, using happiness-based protection');
                // Fallback: periodic happiness boost for leaving guests
                ratingProtectionInterval = context.setInterval(function() {
                    if (protectParkRating) {
                        boostLeavingGuestHappiness(240);
                    }
                }, 5000);
                ratingProtectionActive = true;
            }
        } else if (!protectParkRating && ratingProtectionInterval) {
            context.clearInterval(ratingProtectionInterval);
            ratingProtectionInterval = null;
            ratingProtectionActive = false;
            baselineParkRating = null;
            // Clean up any forced rating (fix #1)
            try {
                if (typeof cheats !== 'undefined' && cheats && cheats.forcedParkRating !== undefined) {
                    delete cheats.forcedParkRating;
                }
            } catch (e) {}
            console.log('Broke Guest Manager: Rating protection disabled');
        }
    }

    function maintainParkRating() {
        if (!ratingProtectionActive) return;

        try {
            var currentRating = getParkRating();
            if (currentRating === null) return;

            var result = boostLeavingGuestHappiness(240);
            var leavingCount = result.leavingCount;

            debugLog('Broke Guest Manager: Rating check - Current: ' + currentRating +
                     ', Baseline: ' + baselineParkRating + ', Leaving: ' + leavingCount);

            var expectedPenalty = leavingCount > 25 ? (leavingCount - 25) * 7 : 0;
            var tolerableRatingDrop = expectedPenalty + 20;

            if (baselineParkRating !== null && currentRating < (baselineParkRating - tolerableRatingDrop)) {
                var ratingDeficit = baselineParkRating - currentRating;
                console.log('Broke Guest Manager: Rating protection triggered - ' + leavingCount +
                           ' guests leaving, rating dropped ' + ratingDeficit + ' points');

                // Emergency: use forced rating if severe
                if (ratingDeficit > 100) {
                    try {
                        if (typeof cheats !== 'undefined' && cheats) {
                            console.log('Broke Guest Manager: Severe rating drop, activating emergency protection');
                            cheats.forcedParkRating = Math.max(baselineParkRating - 50, currentRating + 50);
                            // Schedule cleanup (fix #1)
                            context.setTimeout(function() {
                                try {
                                    if (cheats.forcedParkRating !== undefined) {
                                        delete cheats.forcedParkRating;
                                        console.log('Broke Guest Manager: Emergency protection released');
                                    }
                                } catch (e) {}
                            }, 30000);
                        }
                    } catch (error) {
                        console.log('Broke Guest Manager: Emergency protection failed: ' + error);
                    }
                }
            }

            // Allow baseline to improve when no guests are leaving
            if (leavingCount === 0 && currentRating > baselineParkRating) {
                baselineParkRating = currentRating;
            }
        } catch (error) {
            console.log('Broke Guest Manager: Error in rating protection: ' + error);
        }
    }

    // ── Auto-Send ──────────────────────────────────────────────────────────

    function updateAutoSend() {
        if ((autoSendHome || autoSendCantAfford) && !updateInterval) {
            updateInterval = context.setInterval(function() {
                var didSend = false;

                if (customMoneyThreshold !== null) {
                    if (autoSendHome || autoSendCantAfford) {
                        var targetGuests = getCantAffordGuests();
                        if (targetGuests.length > 0) {
                            for (var i = 0; i < targetGuests.length; i++) {
                                var guest = targetGuests[i];
                                if (instantDelete || !guestsSentButStillWalking[guest.id]) {
                                    sendGuestHome(guest);
                                    didSend = true;
                                }
                            }
                        }
                    }
                } else {
                    if (autoSendHome) {
                        var brokeGuests = getBrokeGuests();
                        if (brokeGuests.length > 0) {
                            for (var j = 0; j < brokeGuests.length; j++) {
                                if (instantDelete || !guestsSentButStillWalking[brokeGuests[j].id]) {
                                    sendGuestHome(brokeGuests[j]);
                                    didSend = true;
                                }
                            }
                        }
                    }
                    if (autoSendCantAfford) {
                        var cantAffordGuests = getCantAffordGuests();
                        if (cantAffordGuests.length > 0) {
                            for (var k = 0; k < cantAffordGuests.length; k++) {
                                if (instantDelete || !guestsSentButStillWalking[cantAffordGuests[k].id]) {
                                    sendGuestHome(cantAffordGuests[k]);
                                    didSend = true;
                                }
                            }
                        }
                    }
                }

                if (didSend && protectParkRating) {
                    boostLeavingGuestHappiness();
                }
                if (didSend) {
                    updateBrokeGuestDisplay();
                }
            }, autoSendInterval);
        } else if (!autoSendHome && !autoSendCantAfford && updateInterval) {
            context.clearInterval(updateInterval);
            updateInterval = null;
        }
    }

    // ── UI: Advanced Window ────────────────────────────────────────────────

    function createAdvancedWindow() {
        if (advancedWindow) {
            advancedWindow.close();
        }

        advancedWindow = ui.openWindow({
            classification: ADVANCED_CLASSIFICATION,
            title: 'Advanced Settings',
            width: 320,
            height: 200,
            widgets: [
                {
                    type: 'checkbox', name: 'useCustomThresholdCheckbox',
                    x: 10, y: 20, width: 200, height: 15,
                    text: 'Use custom threshold',
                    isChecked: customMoneyThreshold !== null,
                    onChange: function(isChecked) {
                        if (isChecked) {
                            customMoneyThreshold = Math.max(10, internalToDisplay(getCheapestRidePrice() || 100));
                        } else {
                            customMoneyThreshold = null;
                        }
                        saveSettings();
                        updateAdvancedDisplay();
                        updateBrokeGuestDisplay();
                    }
                },
                {
                    type: 'label', name: 'currencySymbolLabel',
                    x: 10, y: 48, width: 20, height: 15,
                    text: getCurrencySymbol()
                },
                {
                    type: 'textbox', name: 'thresholdTextbox',
                    x: 25, y: 45, width: 80, height: 20,
                    text: customMoneyThreshold !== null ? Math.round(customMoneyThreshold).toString() : '0',
                    onChange: function(text) {
                        if (customMoneyThreshold !== null) {
                            var value = parseInt(text);
                            if (!isNaN(value) && value >= 0) {
                                customMoneyThreshold = value;
                                saveSettings();
                                updateAdvancedDisplay();
                                updateBrokeGuestDisplay();
                            }
                        }
                    }
                },
                {
                    type: 'button', name: 'thresholdUpButton',
                    x: 110, y: 45, width: 20, height: 20, text: '+',
                    onClick: function() {
                        if (customMoneyThreshold !== null) {
                            customMoneyThreshold = Math.max(0, customMoneyThreshold + 1);
                            saveSettings();
                            updateAdvancedDisplay();
                            updateBrokeGuestDisplay();
                        }
                    }
                },
                {
                    type: 'button', name: 'thresholdDownButton',
                    x: 135, y: 45, width: 20, height: 20, text: '-',
                    onClick: function() {
                        if (customMoneyThreshold !== null) {
                            customMoneyThreshold = Math.max(0, customMoneyThreshold - 1);
                            saveSettings();
                            updateAdvancedDisplay();
                            updateBrokeGuestDisplay();
                        }
                    }
                },
                {
                    type: 'checkbox', name: 'instantDeleteCheckbox',
                    x: 10, y: 75, width: 300, height: 15,
                    text: 'Instant delete (includes guests already leaving)',
                    isChecked: instantDelete,
                    onChange: function(isChecked) {
                        instantDelete = isChecked;
                        saveSettings();
                        updateAdvancedDisplay();
                    }
                },
                {
                    type: 'checkbox', name: 'protectRatingCheckbox',
                    x: 10, y: 95, width: 280, height: 15,
                    text: 'Protect park rating from leaving guests (recommended)',
                    isChecked: protectParkRating,
                    onChange: function(isChecked) {
                        protectParkRating = isChecked;
                        saveSettings();
                        initializeRatingProtection();
                        updateAdvancedDisplay();
                    }
                },
                {
                    type: 'label', name: 'departureIntervalLabel',
                    x: 10, y: 120, width: 150, height: 15,
                    text: 'Departure tracking interval (s):'
                },
                {
                    type: 'textbox', name: 'departureIntervalTextbox',
                    x: 170, y: 120, width: 50, height: 15,
                    text: departureTrackingInterval.toString(),
                    onChange: function(text) {
                        var value = parseInt(text);
                        if (!isNaN(value) && value >= 5 && value <= 300) {
                            departureTrackingInterval = value;
                            saveSettings();
                            updateAdvancedDisplay();
                            updateBrokeGuestDisplay();
                        }
                    }
                },
                {
                    type: 'label', name: 'autoSendIntervalLabel',
                    x: 10, y: 140, width: 150, height: 15,
                    text: 'Auto-send interval (ms):'
                },
                {
                    type: 'textbox', name: 'autoSendIntervalTextbox',
                    x: 170, y: 140, width: 50, height: 15,
                    text: autoSendInterval.toString(),
                    onChange: function(text) {
                        var value = parseInt(text);
                        if (!isNaN(value) && value >= 1000 && value <= 60000) {
                            autoSendInterval = value;
                            saveSettings();
                            updateAdvancedDisplay();
                            // Restart auto-send with new interval
                            if (updateInterval) {
                                context.clearInterval(updateInterval);
                                updateInterval = null;
                                updateAutoSend();
                            }
                        }
                    }
                },
                {
                    type: 'label', name: 'warningLabel',
                    x: 10, y: 165, width: 300, height: 15,
                    text: instantDelete ? 'WARNING: Guests will be deleted instantly!' : 'Normal mode: Guests walk to exit'
                },
                {
                    type: 'button', name: 'closeAdvancedButton',
                    x: 10, y: 185, width: 80, height: 20,
                    text: 'Close',
                    onClick: function() {
                        advancedWindow.close();
                        advancedWindow = null;
                    }
                }
            ],
            onClose: function() {
                advancedWindow = null;
            }
        });

        updateAdvancedDisplay();
    }

    function updateAdvancedDisplay() {
        if (!advancedWindow) return;

        advancedWindow.findWidget('currencySymbolLabel').text = getCurrencySymbol();

        var textbox = advancedWindow.findWidget('thresholdTextbox');
        var upButton = advancedWindow.findWidget('thresholdUpButton');
        var downButton = advancedWindow.findWidget('thresholdDownButton');
        var isCustom = customMoneyThreshold !== null;

        textbox.text = isCustom ? Math.round(customMoneyThreshold).toString() : '0';
        textbox.isDisabled = !isCustom;
        upButton.isDisabled = !isCustom;
        downButton.isDisabled = !isCustom;

        advancedWindow.findWidget('warningLabel').text = instantDelete
            ? 'WARNING: Guests will be deleted instantly!'
            : 'Normal mode: Guests walk to exit';
        advancedWindow.findWidget('departureIntervalTextbox').text = departureTrackingInterval.toString();
        advancedWindow.findWidget('autoSendIntervalTextbox').text = autoSendInterval.toString();
    }

    // ── UI: Main Window ────────────────────────────────────────────────────

    function createBrokeGuestWindow() {
        if (brokeGuestWindow) {
            brokeGuestWindow.close();
        }

        brokeGuestWindow = ui.openWindow({
            classification: CLASSIFICATION,
            title: 'Broke Guest Manager',
            width: 380,
            height: 170,
            widgets: [
                {
                    type: 'label', name: 'brokeCountLabel',
                    x: 10, y: 20, width: 360, height: 15,
                    text: 'Loading...'
                },
                {
                    type: 'label', name: 'cheapestRideLabel',
                    x: 10, y: 35, width: 360, height: 15,
                    text: 'Threshold: Loading...'
                },
                {
                    type: 'label', name: 'sentCounterLabel',
                    x: 10, y: 50, width: 360, height: 15,
                    text: 'Guests who left park: 0'
                },
                {
                    type: 'button', name: 'sendBrokeButton',
                    x: 10, y: 75, width: 90, height: 25,
                    text: customMoneyThreshold !== null ? 'Send Below' : 'Send Broke',
                    onClick: function() { sendGuestsHome('broke'); updateBrokeGuestDisplay(); }
                },
                {
                    type: 'button', name: 'sendCantAffordButton',
                    x: 110, y: 75, width: 100, height: 25,
                    text: customMoneyThreshold !== null ? 'Send Below Limit' : 'Send Cant Afford',
                    onClick: function() { sendGuestsHome('cantafford'); updateBrokeGuestDisplay(); }
                },
                {
                    type: 'button', name: 'sendAllButton',
                    x: 220, y: 75, width: 70, height: 25,
                    text: 'Send All',
                    onClick: function() { sendGuestsHome('all'); updateBrokeGuestDisplay(); }
                },
                {
                    type: 'button', name: 'advancedButton',
                    x: 300, y: 75, width: 70, height: 25,
                    text: 'Advanced',
                    onClick: createAdvancedWindow
                },
                {
                    type: 'button', name: 'refreshButton',
                    x: 10, y: 110, width: 60, height: 20,
                    text: 'Refresh',
                    onClick: updateBrokeGuestDisplay
                },
                {
                    type: 'button', name: 'resetCounterButton',
                    x: 80, y: 110, width: 80, height: 20,
                    text: 'Reset Counter',
                    onClick: function() { resetCounter(); updateBrokeGuestDisplay(); }
                },
                {
                    type: 'checkbox', name: 'autoSendCheckbox',
                    x: 10, y: 140, width: 130, height: 15,
                    text: customMoneyThreshold !== null ? 'Auto-send below' : 'Auto-send broke',
                    isChecked: autoSendHome,
                    onChange: function(isChecked) { autoSendHome = isChecked; updateAutoSend(); }
                },
                {
                    type: 'checkbox', name: 'autoSendCantAffordCheckbox',
                    x: 150, y: 140, width: 150, height: 15,
                    text: customMoneyThreshold !== null ? 'Auto-send below limit' : 'Auto-send cant afford',
                    isChecked: autoSendCantAfford,
                    onChange: function(isChecked) { autoSendCantAfford = isChecked; updateAutoSend(); }
                }
            ],
            onClose: function() {
                if (updateInterval) {
                    context.clearInterval(updateInterval);
                    updateInterval = null;
                }
                if (ratingProtectionInterval) {
                    context.clearInterval(ratingProtectionInterval);
                    ratingProtectionInterval = null;
                }
                // Clean up forced rating on window close
                try {
                    if (typeof cheats !== 'undefined' && cheats && cheats.forcedParkRating !== undefined) {
                        delete cheats.forcedParkRating;
                    }
                } catch (e) {}
                if (advancedWindow) {
                    advancedWindow.close();
                    advancedWindow = null;
                }
                brokeGuestWindow = null;
            }
        });

        // Initialize rating protection when window opens
        initializeRatingProtection();
        updateBrokeGuestDisplay();
    }

    function updateBrokeGuestDisplay() {
        if (!brokeGuestWindow) return;

        updateGuestDepartureTracking();

        var brokeGuests = getBrokeGuests();
        var cantAffordGuests = getCantAffordGuests();
        var threshold = getMoneyThreshold();
        var hasPaidRides = hasAnyPaidRides();
        var leavingGuestsCount = instantDelete ? getGuestsAlreadyLeaving().length : 0;

        var countText;
        if (customMoneyThreshold !== null) {
            countText = 'Guests below ' + formatCurrency(displayToInternal(customMoneyThreshold)) + ': ' + cantAffordGuests.length;
            if (instantDelete && leavingGuestsCount > 0) {
                countText += ' (+ ' + leavingGuestsCount + ' already leaving)';
            }
        } else {
            countText = 'Broke guests: ' + brokeGuests.length;
            if (cantAffordGuests.length > 0) {
                countText += ' | Cant afford: ' + cantAffordGuests.length;
            }
            if (instantDelete && leavingGuestsCount > 0) {
                countText += ' (+ ' + leavingGuestsCount + ' already leaving)';
            }
        }

        var thresholdText;
        if (customMoneyThreshold !== null) {
            thresholdText = 'Custom threshold: ' + formatCurrency(displayToInternal(customMoneyThreshold));
        } else if (threshold > 0) {
            thresholdText = 'Cheapest ride: ' + formatCurrency(threshold);
        } else {
            thresholdText = 'All rides are free';
        }

        var stillWalkingCount = getStillWalkingCount();
        var sentText = 'Guests who left park: ' + guestsActuallyLeft;
        if (stillWalkingCount > 0) {
            sentText += ' (+ ' + stillWalkingCount + ' walking out)';
        }
        if (instantDelete) {
            sentText += ' [instant mode]';
        }
        if (protectParkRating && stillWalkingCount > 0) {
            sentText += ' [rating protected]';
        }
        sentText += ' (updates every ' + departureTrackingInterval + 's)';

        brokeGuestWindow.findWidget('brokeCountLabel').text = countText;
        brokeGuestWindow.findWidget('cheapestRideLabel').text = thresholdText;
        brokeGuestWindow.findWidget('sentCounterLabel').text = sentText;

        // Update button labels based on mode
        var sendBrokeButton = brokeGuestWindow.findWidget('sendBrokeButton');
        var cantAffordButton = brokeGuestWindow.findWidget('sendCantAffordButton');
        var brokeCheckbox = brokeGuestWindow.findWidget('autoSendCheckbox');
        var cantAffordCheckbox = brokeGuestWindow.findWidget('autoSendCantAffordCheckbox');

        if (customMoneyThreshold !== null) {
            sendBrokeButton.text = 'Send Below';
            cantAffordButton.text = 'Send Below Limit';
            brokeCheckbox.text = 'Auto-send below';
            cantAffordCheckbox.text = 'Auto-send below limit';
            cantAffordButton.isDisabled = false;
            cantAffordCheckbox.isDisabled = false;
        } else {
            sendBrokeButton.text = 'Send Broke';
            cantAffordButton.text = 'Send Cant Afford';
            brokeCheckbox.text = 'Auto-send broke';
            cantAffordCheckbox.text = 'Auto-send cant afford';

            var shouldDisable = !hasPaidRides;
            cantAffordButton.isDisabled = shouldDisable;
            cantAffordCheckbox.isDisabled = shouldDisable;
            if (shouldDisable && autoSendCantAfford) {
                autoSendCantAfford = false;
                cantAffordCheckbox.isChecked = false;
                updateAutoSend();
            }
        }

        updateAdvancedDisplay();
    }

    // ── Registration ───────────────────────────────────────────────────────

    ui.registerMenuItem('Broke Guest Manager', function() {
        createBrokeGuestWindow();
    });

    console.log('Broke Guest Manager v' + PLUGIN_VERSION + ' loaded');
};

registerPlugin({
    name: 'Broke Guest Manager',
    version: '12.0.0',
    authors: ['evenwebb'],
    type: 'local',
    licence: 'MIT',
    description: 'Manages broke guests with park rating protection, custom thresholds, auto-send, and instant delete',
    main: main
});
