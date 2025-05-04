// static/js/map_interaction.js (Real-time Update Version)

/**
 * Initializes map interactions, called by the inline script in the HTML.
 * @param {L.Map} mapInstance - The Leaflet map instance.
 * @param {string} areaPropName - The GeoJSON property key containing the area name.
 */
function initializeMapInteraction(mapInstance, areaPropName) {
    if (!mapInstance) {
        console.error("initializeMapInteraction: Invalid map instance provided.");
        return;
    }
     if (!areaPropName) {
        console.error("initializeMapInteraction: Invalid area property name provided.");
        return;
    }
    // Use mapInstance._container.id for logging if available, otherwise just log the object
    const mapLogId = mapInstance._container ? mapInstance._container.id : mapInstance;
    console.log(`Initializing interactions for map ${mapLogId} using property '${areaPropName}'`);

    // Iterate through layers on the map to find GeoJSON features
    mapInstance.eachLayer(function(layer) {
        // Check if it's a layer group or a layer with feature data
        if (layer instanceof L.GeoJSON || (layer.feature && layer.feature.properties)) {
            if (typeof layer.eachLayer === 'function') {
                // If it's a layer group (like the one Folium creates)
                layer.eachLayer(function(featureLayer) {
                    // Attach listener to each sub-layer (feature)
                    attachClickListener(featureLayer, areaPropName, mapInstance);
                });
            } else if (layer.feature) {
                // If the layer itself is the feature
                 attachClickListener(layer, areaPropName, mapInstance);
            }
        }
    });
    console.log("Click listeners potentially attached via initializeMapInteraction.");
}

/**
 * Attaches a click listener to a specific geographic feature layer.
 * @param {L.Layer} featureLayer - The Leaflet layer containing feature data.
 * @param {string} areaPropName - The GeoJSON property key for the area name.
 * @param {L.Map} mapInstance - Optional: The Leaflet map instance.
 */
function attachClickListener(featureLayer, areaPropName, mapInstance) {
    // Ensure the layer has the necessary feature data
    if (!featureLayer.feature || !featureLayer.feature.properties) {
        // console.debug("Skipping layer - no feature/properties:", featureLayer);
        return;
    }
    // Get the area name from the feature's properties
    const areaName = featureLayer.feature.properties[areaPropName];
    if (!areaName) {
        // console.debug("Skipping layer - no area name found with prop:", areaPropName, featureLayer.feature.properties);
        return; // Skip if area name is missing
    }

    // Remove any previously attached click listeners to prevent duplicates
    featureLayer.off('click');

    // Attach the new click listener
    featureLayer.on('click', function(e) {
        // Stop the event from propagating to the map or other elements
        L.DomEvent.stopPropagation(e);
        // Prevent any default browser action associated with the click
        L.DomEvent.preventDefault(e);

        console.log(`Clicked on: ${areaName}`);

        // Send the request to the Flask backend endpoint
        fetch('/add_clicked_area', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // Add CSRF token header here if needed in your Flask setup
            },
            body: JSON.stringify({ area_name: areaName }) // Send area name
        })
        .then(response => {
            // Handle HTTP errors (status codes other than 2xx)
            if (!response.ok) {
                return response.json()
                    .catch(() => {
                        // If response is not JSON or parsing fails
                        throw new Error(`伺服器錯誤: ${response.status} ${response.statusText || 'No status text'}`);
                    })
                    .then(errData => {
                         // If server sent a JSON error message
                         throw new Error(errData.message || `伺服器錯誤: ${response.status}`);
                    });
            }
             // Check if response is JSON before parsing
             const contentType = response.headers.get("content-type");
             if (contentType && contentType.indexOf("application/json") !== -1) {
                 return response.json();
             } else {
                 // Handle cases where server sends non-JSON success response (if applicable)
                 // Or throw error if JSON was expected
                 console.warn("Server response was not JSON.");
                 // Assuming success if status was OK but no JSON body for this example
                 return { success: true, message: '操作成功，但伺服器未返回 JSON。' };
                 // throw new Error("從伺服器收到的回應不是 JSON 格式");
             }
        })
        .then(data => {
            // Process the successful response data
            console.log('Server response:', data);
            if (data.success) {
                // Update UI immediately without full page reload
                console.log('Adding successful, updating UI.');

                // 1. Update Map Style (change color to green)
                try {
                    featureLayer.setStyle({ fillColor: '#008000', fillOpacity: 0.6 });
                    // Optional: Disable further clicks on this added layer
                    // featureLayer.off('click');
                } catch (styleError) {
                    console.error("Error setting feature style:", styleError);
                }

                // 2. Update Visited List in Sidebar
                updateVisitedList(areaName);

                // 3. Update Dropdown Menu (remove added area)
                updateDropdown(areaName);

                // 4. Update Counter
                updateCounter();

                // 5. Show temporary success feedback message
                showFeedback(`已新增: ${areaName}`);

            } else {
                 // Handle cases where server indicates operation failed (e.g., already visited)
                console.warn(`Operation not successful: ${data.message || 'Unknown reason'}`);
                showFeedback(`無法新增 ${areaName}: ${data.message || '已存在或發生錯誤'}`, true); // Show as error
            }
        })
        .catch(error => {
            // Handle network errors or errors thrown previously
            console.error(`Error adding area ${areaName}:`, error);
            showFeedback(`新增 ${areaName} 時發生錯誤: ${error.message}`, true); // Show as error
        });
    });
     // console.log(`Listener attached for ${areaName}`); // Uncomment for verbose logging
}

// --- Helper functions for updating the UI ---

/**
 * Updates the visited list in the sidebar.
 * @param {string} areaName - The name of the area to add.
 */
function updateVisitedList(areaName) {
    const visitedList = document.getElementById('visited-list');
    if (!visitedList) { console.error("Element #visited-list not found."); return; }

    // Remove the 'empty' message list item if it's present
    const emptyMessage = visitedList.querySelector('.empty-message');
    if (emptyMessage) {
        emptyMessage.remove();
    }

    // Check if item already exists (shouldn't happen if server logic is correct, but good defense)
    let exists = false;
    visitedList.querySelectorAll('li').forEach(item => {
        if (item.textContent === areaName) {
            exists = true;
        }
    });

    // Add the new list item only if it doesn't already exist
    if (!exists) {
        const newItem = document.createElement('li');
        newItem.textContent = areaName;
        visitedList.appendChild(newItem);
        // Optional: Sort list items alphabetically after adding
        sortList(visitedList);
    }
}

/**
 * Removes an area from the dropdown select element.
 * @param {string} areaName - The value of the option to remove.
 */
function updateDropdown(areaName) {
    const selectElement = document.getElementById('area-select');
    if (!selectElement) { console.error("Element #area-select not found."); return; }

    // Find the option element with the matching value attribute
    const optionToRemove = selectElement.querySelector(`option[value="${areaName}"]`);
    if (optionToRemove) {
        optionToRemove.remove();
    } else {
         console.warn(`Option with value "${areaName}" not found in #area-select dropdown.`);
    }
}

/**
 * Updates the visited area counter display.
 */
function updateCounter() {
    const countElement = document.getElementById('visited-count');
    if (!countElement) { console.error("Element #visited-count not found."); return; }

    // More robust way: count items in the list directly
    const visitedList = document.getElementById('visited-list');
     if (visitedList) {
        // Count only non-empty list items
        const items = visitedList.querySelectorAll('li:not(.empty-message)');
        countElement.textContent = items.length;
    } else {
         // Fallback if list not found (less accurate)
         try {
            const currentCount = parseInt(countElement.textContent || '0', 10);
            countElement.textContent = currentCount + 1;
        } catch (e) { console.error("Error updating counter:", e); }
    }
}

/**
 * Displays a temporary feedback message to the user.
 * @param {string} message - The message to display.
 * @param {boolean} [isError=false] - If true, styles the message as an error.
 */
function showFeedback(message, isError = false) {
    const feedbackElement = document.getElementById('feedback-message');
    if (!feedbackElement) { console.error("Element #feedback-message not found."); return; }

    feedbackElement.textContent = message;
    feedbackElement.className = isError ? 'error' : ''; // Reset classes or add 'error'
    feedbackElement.style.backgroundColor = isError ? '#f44336' : '#4CAF50'; // Red for error, Green for success
    feedbackElement.style.display = 'block';
    feedbackElement.style.opacity = 1; // Fade in

    // Set timeout to fade out and hide the message
    setTimeout(() => {
        feedbackElement.style.opacity = 0;
        // Set display to none after the fade out transition completes
        setTimeout(() => { feedbackElement.style.display = 'none'; }, 500); // Duration should match CSS transition
    }, 3000); // Message visible for 3 seconds
}

/**
 * Sorts the list items alphabetically within a UL element.
 * @param {HTMLUListElement} ul - The UL element to sort.
 */
function sortList(ul) {
    if (!ul) return;
    Array.from(ul.getElementsByTagName("li"))
        .sort((a, b) => a.textContent.localeCompare(b.textContent, 'zh-Hant')) // Locale compare for Chinese sorting
        .forEach(li => ul.appendChild(li)); // Re-append in sorted order
}

// Note: No DOMContentLoaded listener needed here as initialization
// is triggered by the inline script added by create_map in Python.