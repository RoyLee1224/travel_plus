# app.py (External JS Version with Real-time Updates)

from flask import Flask, render_template, request, jsonify, redirect, url_for
import folium
from branca.element import Element # Correct import for adding raw HTML/JS
import json
import os

# --- Flask App Configuration ---
# By default, Flask looks for templates in 'templates' and static files in 'static'
app = Flask(__name__)

# --- Constants ---
VISITED_TAIWAN_AREAS_FILE = 'visited_taiwan_areas.json'
GEOJSON_PATH = 'taiwan_counties.geojson'     # Assumes file is in the same directory
GEOJSON_AREA_PROPERTY = 'COUNTYNAME'         # !!! Double-check this property name in your GeoJSON !!!

# --- Data Handling Functions ---

def load_visited_areas():
    """從 JSON 檔案載入已訪問縣市列表"""
    if not os.path.exists(VISITED_TAIWAN_AREAS_FILE):
        return []
    try:
        with open(VISITED_TAIWAN_AREAS_FILE, 'r', encoding='utf-8') as f:
            content = f.read()
            return json.loads(content) if content else []
    except json.JSONDecodeError:
        print(f"Error decoding JSON from {VISITED_TAIWAN_AREAS_FILE}. Returning empty list.")
        return []
    except Exception as e:
        print(f"Error loading visited areas: {e}")
        return []

def save_visited_areas(areas_list):
    """將已訪問縣市列表儲存到 JSON 檔案"""
    try:
        unique_areas = sorted(list(set(areas_list)))
        with open(VISITED_TAIWAN_AREAS_FILE, 'w', encoding='utf-8') as f:
            json.dump(unique_areas, f, ensure_ascii=False, indent=4)
        return True
    except Exception as e:
        print(f"Error saving visited areas: {e}")
        return False

# --- GeoJSON and Map Handling Functions ---

def load_geojson():
    """載入台灣縣市 GeoJSON 檔案並提取可用縣市列表"""
    if not os.path.exists(GEOJSON_PATH):
        print(f"錯誤: 找不到 GeoJSON 檔案 {GEOJSON_PATH}")
        return None, []
    try:
        with open(GEOJSON_PATH, 'r', encoding='utf-8') as f:
            taiwan_geo = json.load(f)
        available_areas = sorted([
            feature['properties'][GEOJSON_AREA_PROPERTY]
            for feature in taiwan_geo.get('features', [])
            if feature.get('properties') and GEOJSON_AREA_PROPERTY in feature['properties']
        ])
        if not available_areas:
            print(f"警告: 無法使用屬性 '{GEOJSON_AREA_PROPERTY}' 從 GeoJSON 提取縣市名稱。")
        return taiwan_geo, available_areas
    except KeyError:
        print(f"錯誤: 在 GeoJSON features 中找不到屬性 '{GEOJSON_AREA_PROPERTY}'。")
        return None, []
    except Exception as e:
        print(f"載入或處理 GeoJSON 時發生錯誤: {e}")
        return None, []

def get_area_bounds(taiwan_geo, area_name):
    """根據縣市名稱查找其在 GeoJSON 中的邊界"""
    if not taiwan_geo: return None
    for feature in taiwan_geo.get('features', []):
        properties = feature.get('properties')
        if properties and properties.get(GEOJSON_AREA_PROPERTY) == area_name:
            try: return folium.GeoJson(feature).get_bounds()
            except Exception as e: print(f"警告：無法計算縣市 '{area_name}' 的邊界: {e}"); return None
    return None

def create_map(visited_areas, taiwan_geo, zoom_to_bounds=None):
    """創建 Folium 地圖物件，並附加觸發外部 JS 初始化的內聯腳本"""
    initial_location = [23.7, 120.9]; initial_zoom = 8
    tile_layer = folium.TileLayer(no_wrap=True)
    m = folium.Map(location=initial_location, zoom_start=initial_zoom, tiles=tile_layer)

    if taiwan_geo:
        def style_function(feature):
            area_name = feature.get('properties', {}).get(GEOJSON_AREA_PROPERTY)
            fill_color = '#008000' if area_name and area_name in visited_areas else '#808080'
            return {'fillColor': fill_color, 'color': 'black', 'weight': 0.5, 'fillOpacity': 0.6}

        geojson_layer = folium.GeoJson(
            data=taiwan_geo, style_function=style_function,
            name='taiwan_counties_geojson' # No tooltip/highlight
        ); geojson_layer.add_to(m)

    # Apply Zoom logic
    if zoom_to_bounds:
        try: m.fit_bounds(zoom_to_bounds, padding=(10, 10))
        except Exception as e: print(f"Error fit_bounds area: {e}"); # Fallback might be needed
    elif taiwan_geo and 'features' in taiwan_geo and taiwan_geo['features']:
         try: m.fit_bounds(folium.GeoJson(taiwan_geo).get_bounds(), padding=(10,10))
         except Exception as e: print(f"Error fit_bounds default: {e}"); m.setView(initial_location, initial_zoom)
    else: m.setView(initial_location, initial_zoom)

    # --- Minimal Inline JavaScript to trigger external JS function ---
    map_id = m.get_name()
    js_area_prop_name = json.dumps(GEOJSON_AREA_PROPERTY) # Embed property name safely

    # This simpler inline script just finds the map and calls the function from the external file
    js_init_code = f"""
<script>
    (function() {{
        var maxAttempts = 10; var interval = 100; var currentAttempt = 0;
        function tryInitMapInteraction() {{
            currentAttempt++;
            // Check if the external JS function is loaded and available
            if (typeof initializeMapInteraction === 'function') {{
                var mapInstance = window['{map_id}'];
                var areaPropName = {js_area_prop_name};
                if (mapInstance) {{
                     console.log("Inline Script: Found map instance '{map_id}', calling initializeMapInteraction.");
                     // Call the function defined in map_interaction.js
                     initializeMapInteraction(mapInstance, areaPropName);
                }} else {{
                     // Map instance not ready yet, retry shortly
                     if(currentAttempt < maxAttempts) setTimeout(tryInitMapInteraction, interval);
                     else console.error("Inline Script: Map instance '{map_id}' not found after retries.");
                }}
            }} else {{
                 // External JS file not loaded/parsed yet, retry shortly
                 if(currentAttempt < maxAttempts) {{
                    console.warn("Inline Script: Function 'initializeMapInteraction' not found. Waiting for external JS...");
                    setTimeout(tryInitMapInteraction, interval);
                 }} else {{
                    console.error("Inline Script: External JS file 'map_interaction.js' failed to load or define 'initializeMapInteraction'.");
                 }}
            }}
        }}
        // Start the check shortly after the map HTML is likely parsed
        setTimeout(tryInitMapInteraction, 50);
    }})();
</script>
"""
    m.get_root().html.add_child(Element(js_init_code))
    # -----------------------------------------------------------

    return m

# --- Load GeoJSON Data At Startup ---
taiwan_geo, available_areas = load_geojson()

# --- Flask Routes ---
@app.route('/', methods=['GET', 'POST'])
def index():
    visited_areas = load_visited_areas(); zoom_to_bounds = None
    if request.method == 'POST' and 'area' in request.form:
        area_name = request.form.get('area')
        if area_name and area_name in available_areas and area_name not in visited_areas:
            visited_areas.append(area_name); save_visited_areas(visited_areas)
            zoom_to_bounds = get_area_bounds(taiwan_geo, area_name)
    folium_map = create_map(visited_areas, taiwan_geo, zoom_to_bounds)
    map_html = folium_map._repr_html_()
    areas_for_dropdown = [area for area in available_areas if area not in visited_areas]
    # Render the template (Flask will look in the 'templates' folder)
    return render_template('index.html', map_html=map_html, available_areas=areas_for_dropdown, visited_areas=sorted(visited_areas))

@app.route('/add_clicked_area', methods=['POST'])
def add_clicked_area():
    data = request.get_json();
    if not data or 'area_name' not in data: return jsonify({'success': False, 'message': '無效的請求資料。'}), 400
    area_name = data.get('area_name')
    if not area_name: return jsonify({'success': False, 'message': '未收到縣市名稱。'}), 400
    if area_name not in available_areas: return jsonify({'success': False, 'message': f'無效的縣市名稱: {area_name}'}), 400
    visited_areas = load_visited_areas()
    if area_name in visited_areas: return jsonify({'success': False, 'message': f'{area_name} 已在清單中。'}), 200
    visited_areas.append(area_name)
    if save_visited_areas(visited_areas): return jsonify({'success': True, 'message': f'已新增 {area_name}。'})
    else: return jsonify({'success': False, 'message': '儲存清單時伺服器發生錯誤。'}), 500

@app.route('/clear')
def clear_visited():
    save_visited_areas([]); return redirect(url_for('index'))

# --- Main Execution Block ---
if __name__ == '__main__':
    if not taiwan_geo: print("錯誤：無法載入台灣縣市 GeoJSON 資料。請確認 'taiwan_counties.geojson' 存在且屬性名稱正確。")
    # Ensure static and template folders exist (optional, Flask usually handles this)
    if not os.path.exists('templates'): os.makedirs('templates')
    if not os.path.exists('static/js'): os.makedirs('static/js', exist_ok=True)
    app.run(debug=True)