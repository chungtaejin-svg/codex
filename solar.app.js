// 전역 변수
let canvas, ctx;
let uploadedImage = null;
let drawnGrids = [];
let drawnPolygons = [];
let currentPolygon = [];
let currentMode = 'polygon'; // Default mode: Polygon (Area)
let isDrawing = false;
let currentLatitude = null; // 현재 지도의 위도 (면적 보정용)

// 카카오맵 폴리곤 관련 전역 변수
let mapPolygons = [];           // 카카오맵 위의 폴리곤 객체들
let mapPolygonData = [];        // 각 폴리곤의 {path, panelInfo} 데이터
let currentMapPolygonPath = []; // 현재 그리고 있는 폴리곤의 좌표
let mapPolyline = null;         // 그리는 중인 보조선
let mapMarkers = [];            // 점 마커들
let mapDrawingMode = false;     // 영역 그리기 모드
let mapAreaOverlays = [];       // 면적 표시 오버레이들
let selectedMapPolygonIndex = -1; // 현재 선택된 폴리곤 인덱스 (-1이면 선택 없음)

// 현재 선택된 패널 모델명 가져오기
function getCurrentPanelModelName() {
    const presetSelect = document.getElementById('panelPreset');
    if (!presetSelect) return '직접 입력';
    const key = presetSelect.value;
    
    if (key === 'custom') {
        return `직접입력 ${config.panelPower}W`;
    } else if (key.startsWith('custom_')) {
        const preset = customPresets[key];
        return preset ? formatCustomPresetName(preset) : '커스텀 모델';
    }
    
    const preset = panelPresets[key];
    return preset ? preset.name : '직접 입력';
}

// 패널 모델의 짧은 이름 (오버레이 표시용)
function getShortPanelName() {
    const presetSelect = document.getElementById('panelPreset');
    if (!presetSelect) return `${config.panelPower}W`;
    const key = presetSelect.value;
    
    if (key === 'custom') {
        return `${config.panelWidth}x${config.panelHeight}mm ${config.panelPower}W`;
    } else if (key.startsWith('custom_')) {
        const preset = customPresets[key];
        return preset ? formatCustomPresetName(preset) : `${config.panelPower}W`;
    }
    
    const preset = panelPresets[key];
    return preset ? preset.name : `${config.panelPower}W`;
}

// 커스텀 모델명 표기 (회사명 선택 입력 지원)
function formatCustomPresetName(preset) {
    if (!preset) return '';
    const company = (preset.company || '').trim();
    const name = (preset.name || '').trim();
    if (company && name) return `${company} - ${name}`;
    return company || name || '커스텀 모델';
}

// 설정 값 (mm 단위로 변경)
let config = {
    panelWidth: 2278,      // mm
    panelHeight: 1134,     // mm
    panelPower: 640,       // W
    gridRows: 8,
    gridCols: 12,
    spacing: 50,           // mm
    rotation: 0,
    zoomLevel: 2,          // 카카오맵 레벨
    metersPerPixel: 0.30   // 카카오맵 레벨 2 기본값
};

// 패널 프리셋 데이터 (기본 프리셋 비활성화)
const panelPresets = {};

// 카카오맵 레벨별 스케일 계산 함수
function getKakaoMetersPerPixel(level, latitude) {
    const webMercatorZoom = 22 - level;
    const latRad = (latitude || 37.0) * Math.PI / 180;
    return 156543.04 * Math.cos(latRad) / Math.pow(2, webMercatorZoom);
}

// 초기화
document.addEventListener('DOMContentLoaded', () => {
    canvas = document.getElementById('canvas');
    ctx = canvas.getContext('2d');

    loadCustomPresets(); // 커스텀 프리셋 로드
    initializeEventListeners();
    
    // 초기 UI 상태 설정을 위해 이벤트 트리거
    const presetSelect = document.getElementById('panelPreset');
    // 기본값을 'custom'으로 설정하고 이벤트 발생
    if (presetSelect.value === 'custom') {
        presetSelect.dispatchEvent(new Event('change'));
    }

    updateInfo();
    updateScaleInfo();
});

// 커스텀 프리셋 로드
let customPresets = {};
function normalizeNumber(value) {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : null;
}

function normalizePresetEntry(entry, fallbackName) {
    if (!entry || typeof entry !== 'object') return null;

    const hasNameField = typeof entry.name === 'string' || typeof entry.modelName === 'string' || typeof entry.model === 'string';
    const hasCompanyField = typeof entry.company === 'string' || typeof entry.companyName === 'string' || typeof entry.manufacturer === 'string';
    const hasDimensionField = (
        entry.width != null || entry.height != null || entry.power != null ||
        entry.panelWidth != null || entry.panelHeight != null || entry.panelPower != null ||
        entry.w != null || entry.h != null || entry.watt != null
    );
    if (!hasNameField && !hasCompanyField && !hasDimensionField) return null;

    const name = String(
        entry.name ||
        entry.modelName ||
        entry.model ||
        fallbackName ||
        ''
    ).trim();
    const company = String(
        entry.company ||
        entry.companyName ||
        entry.manufacturer ||
        ''
    ).trim();

    if (!name && !company) return null;

    const width = normalizeNumber(entry.width ?? entry.panelWidth ?? entry.w);
    const height = normalizeNumber(entry.height ?? entry.panelHeight ?? entry.h);
    const power = normalizeNumber(entry.power ?? entry.panelPower ?? entry.watt);

    return {
        name: name || '커스텀 모델',
        company,
        width: width ?? config.panelWidth,
        height: height ?? config.panelHeight,
        power: power ?? config.panelPower
    };
}

function normalizeCustomPresets(raw) {
    const result = {};

    if (Array.isArray(raw)) {
        raw.forEach((entry, idx) => {
            const normalized = normalizePresetEntry(entry, `커스텀 모델 ${idx + 1}`);
            if (!normalized) return;
            const key = String(
                (entry && (entry.id || entry.key)) ||
                `custom_legacy_${idx + 1}`
            );
            result[key] = normalized;
        });
        return result;
    }

    if (raw && typeof raw === 'object') {
        Object.entries(raw).forEach(([key, entry], idx) => {
            const normalized = normalizePresetEntry(entry, key || `커스텀 모델 ${idx + 1}`);
            if (!normalized) return;
            const safeKey = key && key !== 'undefined' && key !== 'null'
                ? String(key)
                : `custom_legacy_${idx + 1}`;
            result[safeKey] = normalized;
        });
    }

    return result;
}

function loadCustomPresets() {
    const stored = localStorage.getItem('solar_custom_presets');
    if (stored) {
        try {
            const parsed = JSON.parse(stored);
            customPresets = normalizeCustomPresets(parsed);
        } catch (e) {
            console.error('Failed to load presets', e);
            customPresets = {};
        }
    }
    localStorage.setItem('solar_custom_presets', JSON.stringify(customPresets));
    updatePresetDropdown();
}

// 드롭다운 메뉴 업데이트
function updatePresetDropdown() {
    const select = document.getElementById('panelPreset');
    const currentValue = select.value;

    // 기존 옵션 중 커스텀 그룹 제거 (있다면)
    const existingGroup = select.querySelector('optgroup[label="나의 커스텀 모델"]');
    if (existingGroup) {
        existingGroup.remove();
    }

    const keys = Object.keys(customPresets);
    if (keys.length > 0) {
        const group = document.createElement('optgroup');
        group.label = "나의 커스텀 모델";
        
        // 최신순으로 정렬
        keys.reverse().forEach(key => {
            const preset = customPresets[key];
            const option = document.createElement('option');
            option.value = key;
            option.textContent = formatCustomPresetName(preset);
            group.appendChild(option);
        });

        // "직접 입력" 옵션 바로 다음에 추가
        if (select.children.length > 1) {
            select.insertBefore(group, select.children[1]);
        } else {
            select.appendChild(group);
        }
    }

    // 이전에 선택된 값이 있으면 유지
    if (currentValue && (currentValue === 'custom' || customPresets[currentValue] || panelPresets[currentValue])) {
        select.value = currentValue;
    }
}

// 이벤트 리스너 초기화
function initializeEventListeners() {
    // 주소 검색
    const searchBtn = document.getElementById('searchBtn');
    const addressInput = document.getElementById('addressInput');

    searchBtn.addEventListener('click', searchAddress);
    addressInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') searchAddress();
    });

    // 줌 레벨
    document.getElementById('zoomLevel').addEventListener('input', (e) => {
        config.zoomLevel = parseInt(e.target.value);
        document.getElementById('zoomValue').textContent = config.zoomLevel;
        config.metersPerPixel = getKakaoMetersPerPixel(config.zoomLevel, currentLatitude);
        updateScaleInfo();
        redrawCanvas();
    });

    // 수동 스케일 입력
    document.getElementById('manualScale').addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        if (value > 0) {
            config.metersPerPixel = value;
            updateScaleInfo();
            redrawCanvas();
            updateInfo();
        }
    });

    // 수동 위도 입력
    document.getElementById('manualLatitude').addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        if (value >= -90 && value <= 90) {
            currentLatitude = value;
            config.metersPerPixel = getKakaoMetersPerPixel(config.zoomLevel, currentLatitude);
            document.getElementById('manualScale').value = config.metersPerPixel.toFixed(4);
            updateScaleInfo();
            redrawCanvas();
            updateInfo();
        }
    });

    // 스케일 계산 도우미
    document.getElementById('calculateScale').addEventListener('click', () => {
        const pixels = parseFloat(document.getElementById('helperPixels').value);
        const meters = parseFloat(document.getElementById('helperMeters').value);

        if (pixels > 0 && meters > 0) {
            const scale = meters / pixels;
            config.metersPerPixel = scale;
            document.getElementById('manualScale').value = scale.toFixed(4);
            updateScaleInfo();
            redrawCanvas();
            updateInfo();
            alert(`✅ 스케일 설정 완료!\n\n1픽셀 = ${scale.toFixed(4)} 미터`);
        } else {
            alert('❌ 픽셀 거리와 실제 거리를 모두 입력해주세요.');
        }
    });

    // 이미지 업로드
    const uploadArea = document.getElementById('uploadArea');
    const imageInput = document.getElementById('imageInput');

    if (uploadArea && imageInput) {
        uploadArea.addEventListener('click', () => imageInput.click());
        imageInput.addEventListener('change', handleImageUpload);

        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('drag-over');
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('drag-over');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('drag-over');
            const file = e.dataTransfer.files[0];
            if (file && file.type.startsWith('image/')) {
                loadImage(file);
            }
        });
    }

    // 캔버스 이벤트
    canvas.addEventListener('click', handleCanvasClick);
    canvas.addEventListener('mousemove', handleCanvasHover);

    // 패널 프리셋 선택
    document.getElementById('panelPreset').addEventListener('change', (e) => {
        const presetKey = e.target.value;

        if (presetKey === 'custom') {
            // 직접 입력 모드 - 입력 필드 활성화
            document.getElementById('panelWidth').disabled = false;
            document.getElementById('panelHeight').disabled = false;
            document.getElementById('panelPower').disabled = false;
        } else if (presetKey.startsWith('custom_')) {
            // 커스텀 프리셋 선택
            const preset = customPresets[presetKey];
            if (preset) {
                config.panelWidth = preset.width;
                config.panelHeight = preset.height;
                config.panelPower = preset.power;

                document.getElementById('panelWidth').value = preset.width;
                document.getElementById('panelHeight').value = preset.height;
                document.getElementById('panelPower').value = preset.power;

                // 비활성화
                document.getElementById('panelWidth').disabled = true;
                document.getElementById('panelHeight').disabled = true;
                document.getElementById('panelPower').disabled = true;

                redrawCanvas();
                updateInfo();
            }
        } else {
            // 기본 프리셋 선택
            const preset = panelPresets[presetKey];
            if (preset) {
                config.panelWidth = preset.width;
                config.panelHeight = preset.height;
                config.panelPower = preset.power;

                document.getElementById('panelWidth').value = preset.width;
                document.getElementById('panelHeight').value = preset.height;
                document.getElementById('panelPower').value = preset.power;

                // 비활성화
                document.getElementById('panelWidth').disabled = true;
                document.getElementById('panelHeight').disabled = true;
                document.getElementById('panelPower').disabled = true;

                redrawCanvas();
                updateInfo();
            }
        }
    });

    // --- 모달 관련 로직 ---
    const modal = document.getElementById('addPanelModal');
    const showModalBtn = document.getElementById('showAddPanelModalBtn');
    const deleteSelectedPanelBtn = document.getElementById('deleteSelectedPanelBtn');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const saveModelBtn = document.getElementById('saveModelBtn');

    // 모달 열기
    showModalBtn.addEventListener('click', () => {
        modal.style.display = 'flex';
        document.getElementById('modalModelName').value = '';
        document.getElementById('modalCompanyName').value = '';
        document.getElementById('modalWidth').value = '';
        document.getElementById('modalHeight').value = '';
        document.getElementById('modalPower').value = '';
        document.getElementById('modalModelName').focus();
    });

    // 모달 닫기
    closeModalBtn.addEventListener('click', () => {
        modal.style.display = 'none';
    });

    // 선택한 커스텀 모델 삭제
    deleteSelectedPanelBtn.addEventListener('click', () => {
        const presetSelect = document.getElementById('panelPreset');
        let selectedKey = presetSelect.value;
        const customEntries = Object.entries(customPresets);

        if (customEntries.length === 0) {
            alert('삭제할 커스텀 모델이 없습니다.');
            return;
        }

        // 드롭다운에서 커스텀 모델이 선택되어 있으면 바로 그 모델 삭제 진행
        if (!selectedKey || !customPresets[selectedKey]) {
            const listText = customEntries
                .map(([_, preset], idx) => `${idx + 1}. ${formatCustomPresetName(preset)}`)
                .join('\n');
            const input = prompt(`삭제할 커스텀 모델 번호를 입력해주세요.\n\n${listText}`);
            if (input === null) return;

            const chosen = parseInt(input, 10);
            if (!chosen || chosen < 1 || chosen > customEntries.length) {
                alert('유효한 번호를 입력해주세요.');
                return;
            }
            selectedKey = customEntries[chosen - 1][0];
        }

        if (!customPresets[selectedKey]) {
            alert('선택된 모델이 저장 목록에 없습니다. 페이지를 새로고침 후 다시 시도해주세요.');
            return;
        }

        const preset = customPresets[selectedKey];
        const label = formatCustomPresetName(preset);
        const ok = confirm(`"${label}" 모델을 삭제할까요?`);
        if (!ok) return;

        delete customPresets[selectedKey];
        localStorage.setItem('solar_custom_presets', JSON.stringify(customPresets));
        updatePresetDropdown();

        presetSelect.value = 'custom';
        presetSelect.dispatchEvent(new Event('change'));

        alert(`🗑️ "${label}" 모델이 삭제되었습니다.`);
    });

    // 모달 외부 클릭 시 닫기
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
        }
    });

    // 모델 저장 (모달 내부)
    saveModelBtn.addEventListener('click', () => {
        const name = document.getElementById('modalModelName').value.trim();
        const company = document.getElementById('modalCompanyName').value.trim();
        const width = parseFloat(document.getElementById('modalWidth').value);
        const height = parseFloat(document.getElementById('modalHeight').value);
        const power = parseFloat(document.getElementById('modalPower').value);

        if (!name) {
            alert('모델명을 입력해주세요.');
            return;
        }
        if (!width || !height || !power) {
            alert('크기와 출력을 모두 숫자로 입력해주세요.');
            return;
        }

        const id = 'custom_' + Date.now();
        customPresets[id] = {
            name: name,
            company: company,
            width: width,
            height: height,
            power: power
        };

        localStorage.setItem('solar_custom_presets', JSON.stringify(customPresets));
        updatePresetDropdown();
        
        // 저장 후 바로 선택
        document.getElementById('panelPreset').value = id;
        // 선택 이벤트 강제 발생시켜 UI 업데이트
        document.getElementById('panelPreset').dispatchEvent(new Event('change'));

        modal.style.display = 'none';
        alert(`✅ "${formatCustomPresetName(customPresets[id])}" 모델이 추가되었습니다.`);
    });

    // 컨트롤 입력
    document.getElementById('panelWidth').addEventListener('input', (e) => {
        config.panelWidth = parseFloat(e.target.value);
        redrawCanvas();
    });

    document.getElementById('panelHeight').addEventListener('input', (e) => {
        config.panelHeight = parseFloat(e.target.value);
        redrawCanvas();
    });

    document.getElementById('panelPower').addEventListener('input', (e) => {
        config.panelPower = parseFloat(e.target.value);
        updateInfo();
    });

    document.getElementById('spacing').addEventListener('input', (e) => {
        config.spacing = parseFloat(e.target.value);
        redrawCanvas();
    });

    document.getElementById('rotation').addEventListener('input', (e) => {
        config.rotation = parseInt(e.target.value);
        document.getElementById('rotationValue').textContent = config.rotation + '°';
        redrawCanvas();
    });

    // 모드 버튼
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentMode = btn.dataset.mode;

            if (currentMode === 'draw' || currentMode === 'polygon') {
                canvas.style.cursor = 'crosshair';
            } else {
                canvas.style.cursor = 'not-allowed';
            }

            if (currentMode !== 'polygon' && currentPolygon.length > 0) {
                currentPolygon = [];
                redrawCanvas();
            }
        });
    });

    // 액션 버튼
    document.getElementById('clearBtn').addEventListener('click', clearAll);
    document.getElementById('undoBtn').addEventListener('click', undo);
    document.getElementById('printBtn').addEventListener('click', printMapView);
}

// ... (나머지 지도/그리기 관련 함수들은 그대로 유지) ...
// 편의를 위해 전체 코드를 다 쓰지 않고 핵심 로직이 잘 연결되도록
// searchAddress, loadSkyviewImage 등의 함수는 위에서 정의한 것과 동일하게 포함됨
// (실제 write 시에는 모든 함수를 다 포함해야 함. 아래에 이어붙임)

function searchAddress() {
    const address = document.getElementById('addressInput').value.trim();

    if (!address) {
        alert('주소를 입력해주세요.');
        return;
    }

    if (typeof kakao === 'undefined' || typeof kakao.maps === 'undefined') {
        alert('카카오맵 SDK가 로드되지 않았습니다.\n\n카카오 개발자 콘솔에서 현재 도메인을 등록해주세요.\nhttps://developers.kakao.com/');
        return;
    }

    const geocoder = new kakao.maps.services.Geocoder();

    geocoder.addressSearch(address, function(result, status) {
        if (status === kakao.maps.services.Status.OK && result.length > 0) {
            const lat = parseFloat(result[0].y);
            const lng = parseFloat(result[0].x);
            loadSkyviewImage(lat, lng);
        } else {
            const places = new kakao.maps.services.Places();
            places.keywordSearch(address, function(result2, status2) {
                if (status2 === kakao.maps.services.Status.OK && result2.length > 0) {
                    const lat = parseFloat(result2[0].y);
                    const lng = parseFloat(result2[0].x);
                    loadSkyviewImage(lat, lng);
                } else {
                    alert('주소를 찾을 수 없습니다. 다시 시도해주세요.');
                }
            });
        }
    });
}

function loadSkyviewImage(lat, lng) {
    currentLatitude = lat;
    config.metersPerPixel = getKakaoMetersPerPixel(config.zoomLevel, lat);

    document.getElementById('manualScale').value = config.metersPerPixel.toFixed(4);
    document.getElementById('manualLatitude').value = lat.toFixed(6);

    const canvasContainer = document.querySelector('.canvas-container');
    let mapWrapper = document.getElementById('kakaoMapWrapper');
    if (mapWrapper) {
        mapWrapper.remove();
    }

    mapPolygons = [];
    mapPolygonData = [];
    currentMapPolygonPath = [];
    mapMarkers = [];
    mapAreaOverlays = [];
    mapDrawingMode = false;
    selectedMapPolygonIndex = -1;

    canvas.style.display = 'none';
    document.getElementById('canvasOverlay').classList.add('hidden');

    mapWrapper = document.createElement('div');
    mapWrapper.id = 'kakaoMapWrapper';
    mapWrapper.style.cssText = 'width:100%; height:640px; position:relative; border-radius:12px; overflow:hidden;';

    const mapDiv = document.createElement('div');
    mapDiv.id = 'kakaoLiveMap';
    mapDiv.style.cssText = 'width:100%; height:100%;';
    mapWrapper.appendChild(mapDiv);

    canvasContainer.appendChild(mapWrapper);

    const mapOption = {
        center: new kakao.maps.LatLng(lat, lng),
        level: config.zoomLevel,
        mapTypeId: kakao.maps.MapTypeId.SKYVIEW
    };

    const map = new kakao.maps.Map(mapDiv, mapOption);

    kakao.maps.event.addListener(map, 'zoom_changed', function() {
        const newLevel = map.getLevel();
        const center = map.getCenter();
        config.zoomLevel = newLevel;
        config.metersPerPixel = getKakaoMetersPerPixel(newLevel, center.getLat());
        currentLatitude = center.getLat();
        document.getElementById('zoomLevel').value = newLevel;
        document.getElementById('zoomValue').textContent = newLevel;
        document.getElementById('manualScale').value = config.metersPerPixel.toFixed(4);
        document.getElementById('manualLatitude').value = center.getLat().toFixed(6);
        updateScaleInfo();
    });

    window._kakaoMap = map;
    window._polygonJustClicked = false;
    
    kakao.maps.event.addListener(map, 'click', function() {
        if (mapDrawingMode) return;
        setTimeout(function() {
            if (window._polygonJustClicked) {
                window._polygonJustClicked = false;
                return;
            }
            if (selectedMapPolygonIndex >= 0) {
                deselectMapPolygon();
            }
        }, 50);
    });

    const controlBar = document.createElement('div');
    controlBar.id = 'mapControlBar';
    controlBar.style.cssText = 'position:absolute; bottom:15px; left:50%; transform:translateX(-50%); z-index:10; display:flex; gap:10px; align-items:center;';

    const drawBtn = document.createElement('button');
    drawBtn.id = 'mapDrawBtn';
    drawBtn.textContent = '📐 영역 그리기';
    drawBtn.style.cssText = 'padding:10px 20px; background:#f59e0b; color:white; border:none; border-radius:8px; font-size:14px; font-weight:bold; cursor:pointer; box-shadow:0 4px 12px rgba(0,0,0,0.3);';
    drawBtn.addEventListener('click', () => toggleMapDrawingMode(map));
    controlBar.appendChild(drawBtn);

    const deleteSelectedBtn = document.createElement('button');
    deleteSelectedBtn.id = 'mapDeleteSelectedBtn';
    deleteSelectedBtn.textContent = '🗑️ 선택 삭제';
    deleteSelectedBtn.style.cssText = 'padding:10px 20px; background:#6b7280; opacity:0.6; color:white; border:none; border-radius:8px; font-size:14px; font-weight:bold; cursor:pointer; box-shadow:0 4px 12px rgba(0,0,0,0.3);';
    deleteSelectedBtn.addEventListener('click', () => deleteSelectedPolygon(map));
    controlBar.appendChild(deleteSelectedBtn);

    const clearMapBtn = document.createElement('button');
    clearMapBtn.textContent = '🗑️ 전체 지우기';
    clearMapBtn.style.cssText = 'padding:10px 20px; background:#dc2626; color:white; border:none; border-radius:8px; font-size:14px; font-weight:bold; cursor:pointer; box-shadow:0 4px 12px rgba(0,0,0,0.3);';
    clearMapBtn.addEventListener('click', () => {
        if (mapPolygons.length === 0) return;
        if (confirm('모든 영역을 삭제하시겠습니까?')) {
            clearMapPolygons(map);
        }
    });
    controlBar.appendChild(clearMapBtn);

    mapWrapper.appendChild(controlBar);

    const guideDiv = document.createElement('div');
    guideDiv.id = 'mapGuide';
    guideDiv.style.cssText = 'position:absolute; top:15px; left:50%; transform:translateX(-50%); z-index:10; padding:10px 20px; background:rgba(0,0,0,0.75); color:white; border-radius:8px; font-size:13px; text-align:center; pointer-events:none;';
    guideDiv.textContent = '📐 "영역 그리기" 버튼을 눌러 설치 영역을 지정하세요';
    mapWrapper.appendChild(guideDiv);

    updateScaleInfo();
    updateMapAreaInfo();
}

function toggleMapDrawingMode(map) {
    const drawBtn = document.getElementById('mapDrawBtn');
    const guideDiv = document.getElementById('mapGuide');

    if (!mapDrawingMode) {
        mapDrawingMode = true;
        currentMapPolygonPath = [];
        drawBtn.textContent = '✅ 그리기 완료 (우클릭)';
        drawBtn.style.background = '#10b981';
        if (guideDiv) guideDiv.textContent = '🖱️ 클릭: 점 추가 | 우클릭: 영역 완성 | 3개 이상의 점이 필요합니다';

        map.setDraggable(false);

        window._mapClickListener = function(mouseEvent) {
            if (!mapDrawingMode) return;
            const latlng = mouseEvent.latLng;
            currentMapPolygonPath.push(latlng);

            const marker = new kakao.maps.CustomOverlay({
                position: latlng,
                content: '<div style="width:12px;height:12px;background:#f59e0b;border:2px solid white;border-radius:50%;box-shadow:0 2px 4px rgba(0,0,0,0.5);"></div>',
                xAnchor: 0.5,
                yAnchor: 0.5,
                zIndex: 3
            });
            marker.setMap(map);
            mapMarkers.push(marker);

            if (mapPolyline) {
                mapPolyline.setMap(null);
            }
            if (currentMapPolygonPath.length > 1) {
                mapPolyline = new kakao.maps.Polyline({
                    map: map,
                    path: currentMapPolygonPath,
                    strokeWeight: 3,
                    strokeColor: '#f59e0b',
                    strokeOpacity: 0.8,
                    strokeStyle: 'dash'
                });
            }

            if (currentMapPolygonPath.length >= 3 && guideDiv) {
                guideDiv.textContent = `🖱️ ${currentMapPolygonPath.length}개 점 | 우클릭으로 영역 완성`;
            }
        };
        kakao.maps.event.addListener(map, 'click', window._mapClickListener);

        window._mapRightClickListener = function(mouseEvent) {
            if (!mapDrawingMode) return;
            if (currentMapPolygonPath.length < 3) {
                alert('최소 3개의 점이 필요합니다.');
                return;
            }
            completeMapPolygon(map);
        };
        kakao.maps.event.addListener(map, 'rightclick', window._mapRightClickListener);

    } else {
        if (currentMapPolygonPath.length >= 3) {
            completeMapPolygon(map);
        } else if (currentMapPolygonPath.length > 0) {
            alert('최소 3개의 점이 필요합니다. 점을 더 추가해주세요.');
            return;
        }
        endMapDrawingMode(map);
    }
}

function completeMapPolygon(map) {
    const guideDiv = document.getElementById('mapGuide');

    if (mapPolyline) {
        mapPolyline.setMap(null);
        mapPolyline = null;
    }

    mapMarkers.forEach(m => m.setMap(null));
    mapMarkers = [];

    const polygon = new kakao.maps.Polygon({
        map: map,
        path: currentMapPolygonPath,
        strokeWeight: 3,
        strokeColor: '#10b981',
        strokeOpacity: 0.9,
        fillColor: '#10b981',
        fillOpacity: 0.25
    });

    mapPolygons.push(polygon);

    const polygonIndex = mapPolygons.length - 1;
    kakao.maps.event.addListener(polygon, 'click', function(mouseEvent) {
        if (mapDrawingMode) return;
        selectMapPolygon(polygonIndex);
    });

    const panelInfo = {
        modelName: getCurrentPanelModelName(),
        shortName: getShortPanelName(),
        width: config.panelWidth,
        height: config.panelHeight,
        power: config.panelPower
    };
    mapPolygonData.push({
        path: [...currentMapPolygonPath],
        panelInfo: panelInfo
    });

    const area = calculateMapPolygonArea(currentMapPolygonPath);

    const centerLat = currentMapPolygonPath.reduce((s, p) => s + p.getLat(), 0) / currentMapPolygonPath.length;
    const centerLng = currentMapPolygonPath.reduce((s, p) => s + p.getLng(), 0) / currentMapPolygonPath.length;

    const panelWidthM = panelInfo.width / 1000;
    const panelHeightM = panelInfo.height / 1000;
    const panelArea = panelWidthM * panelHeightM;
    const estimatedPanels = Math.floor((area * 0.7) / panelArea);
    const estimatedPowerKW = (estimatedPanels * panelInfo.power) / 1000;

    const areaOverlay = new kakao.maps.CustomOverlay({
        position: new kakao.maps.LatLng(centerLat, centerLng),
        content: `<div style="padding:8px 14px; background:rgba(0,0,0,0.85); color:white; border-radius:8px; font-size:12px; line-height:1.6; text-align:center; box-shadow:0 4px 12px rgba(0,0,0,0.4); pointer-events:none; max-width:220px;">
            <div style="font-weight:bold; color:#60a5fa; font-size:11px; margin-bottom:2px;">${panelInfo.shortName}</div>
            <div style="font-weight:bold; color:#10b981;">면적: ${area.toFixed(1)} m²</div>
            <div>예상 패널: ${estimatedPanels}장</div>
            <div>예상 용량: ${estimatedPowerKW.toFixed(1)} kW</div>
        </div>`,
        xAnchor: 0.5,
        yAnchor: 0.5,
        zIndex: 5
    });
    areaOverlay.setMap(map);
    mapAreaOverlays.push(areaOverlay);

    currentMapPolygonPath = [];
    endMapDrawingMode(map);
    updateMapAreaInfo();

    if (guideDiv) {
        guideDiv.textContent = '✅ 영역이 추가되었습니다. 영역 클릭으로 선택/삭제, "영역 그리기"로 추가 가능';
    }
}

function endMapDrawingMode(map) {
    mapDrawingMode = false;
    const drawBtn = document.getElementById('mapDrawBtn');
    if (drawBtn) {
        drawBtn.textContent = '📐 영역 그리기';
        drawBtn.style.background = '#f59e0b';
    }

    map.setDraggable(true);

    if (window._mapClickListener) {
        kakao.maps.event.removeListener(map, 'click', window._mapClickListener);
        window._mapClickListener = null;
    }
    if (window._mapRightClickListener) {
        kakao.maps.event.removeListener(map, 'rightclick', window._mapRightClickListener);
        window._mapRightClickListener = null;
    }

    if (mapPolyline) {
        mapPolyline.setMap(null);
        mapPolyline = null;
    }
    mapMarkers.forEach(m => m.setMap(null));
    mapMarkers = [];
}

function calculateMapPolygonArea(path) {
    if (path.length < 3) return 0;
    const R = 6371000;
    const n = path.length;
    let total = 0;

    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const lat1 = path[i].getLat() * Math.PI / 180;
        const lng1 = path[i].getLng() * Math.PI / 180;
        const lat2 = path[j].getLat() * Math.PI / 180;
        const lng2 = path[j].getLng() * Math.PI / 180;

        total += (lng2 - lng1) * (2 + Math.sin(lat1) + Math.sin(lat2));
    }

    return Math.abs(total * R * R / 2);
}

function selectMapPolygon(index) {
    window._polygonJustClicked = true;

    if (selectedMapPolygonIndex === index) {
        deselectMapPolygon();
        return;
    }

    deselectMapPolygon();

    selectedMapPolygonIndex = index;
    if (mapPolygons[index]) {
        mapPolygons[index].setOptions({
            strokeColor: '#ef4444',
            strokeWeight: 5,
            fillColor: '#ef4444',
            fillOpacity: 0.35
        });
    }

    updateDeleteBtnState();

    const guideDiv = document.getElementById('mapGuide');
    if (guideDiv) {
        guideDiv.textContent = `🔴 영역 ${index + 1} 선택됨 - "선택 삭제" 버튼으로 삭제 가능`;
    }
}

function deselectMapPolygon() {
    if (selectedMapPolygonIndex >= 0 && mapPolygons[selectedMapPolygonIndex]) {
        mapPolygons[selectedMapPolygonIndex].setOptions({
            strokeColor: '#10b981',
            strokeWeight: 3,
            fillColor: '#10b981',
            fillOpacity: 0.25
        });
    }
    selectedMapPolygonIndex = -1;
    updateDeleteBtnState();
}

function updateDeleteBtnState() {
    const deleteBtn = document.getElementById('mapDeleteSelectedBtn');
    if (deleteBtn) {
        if (selectedMapPolygonIndex >= 0) {
            deleteBtn.style.background = '#ef4444';
            deleteBtn.style.opacity = '1';
            deleteBtn.textContent = `🗑️ 영역 ${selectedMapPolygonIndex + 1} 삭제`;
        } else {
            deleteBtn.style.background = '#6b7280';
            deleteBtn.style.opacity = '0.6';
            deleteBtn.textContent = '🗑️ 선택 삭제';
        }
    }
}

function deleteSelectedPolygon(map) {
    if (selectedMapPolygonIndex < 0 || selectedMapPolygonIndex >= mapPolygons.length) {
        return;
    }

    const idx = selectedMapPolygonIndex;

    mapPolygons[idx].setMap(null);
    mapPolygons.splice(idx, 1);
    mapPolygonData.splice(idx, 1);

    if (mapAreaOverlays[idx]) {
        mapAreaOverlays[idx].setMap(null);
    }
    mapAreaOverlays.splice(idx, 1);

    selectedMapPolygonIndex = -1;
    updateDeleteBtnState();

    mapPolygons.forEach((polygon, newIdx) => {
        kakao.maps.event.removeListener(polygon, 'click');
        kakao.maps.event.addListener(polygon, 'click', function() {
            if (mapDrawingMode) return;
            selectMapPolygon(newIdx);
        });
    });

    updateMapAreaInfo();

    const guideDiv = document.getElementById('mapGuide');
    if (guideDiv) {
        if (mapPolygons.length > 0) {
            guideDiv.textContent = `✅ 영역이 삭제되었습니다. (남은 영역: ${mapPolygons.length}개)`;
        } else {
            guideDiv.textContent = '📐 "영역 그리기" 버튼을 눌러 설치 영역을 지정하세요';
        }
    }
}

function clearMapPolygons(map) {
    mapPolygons.forEach(p => p.setMap(null));
    mapPolygons = [];
    mapPolygonData = [];
    mapAreaOverlays.forEach(o => o.setMap(null));
    mapAreaOverlays = [];
    currentMapPolygonPath = [];
    selectedMapPolygonIndex = -1;
    updateDeleteBtnState();

    if (mapPolyline) {
        mapPolyline.setMap(null);
        mapPolyline = null;
    }
    mapMarkers.forEach(m => m.setMap(null));
    mapMarkers = [];

    updateMapAreaInfo();

    const guideDiv = document.getElementById('mapGuide');
    if (guideDiv) {
        guideDiv.textContent = '📐 "영역 그리기" 버튼을 눌러 설치 영역을 지정하세요';
    }
}

function updateMapAreaInfo() {
    let totalArea = 0;
    let totalPanels = 0;
    let totalPowerKW = 0;

    const modelSummary = {};

    mapPolygonData.forEach(data => {
        const area = calculateMapPolygonArea(data.path);
        totalArea += area;

        const pi = data.panelInfo;
        const panelArea = (pi.width / 1000) * (pi.height / 1000);
        const panels = Math.floor((area * 0.7) / panelArea);
        const powerKW = (panels * pi.power) / 1000;

        totalPanels += panels;
        totalPowerKW += powerKW;

        const key = pi.modelName;
        if (!modelSummary[key]) {
            modelSummary[key] = { panels: 0, powerKW: 0, areas: 0, count: 0 };
        }
        modelSummary[key].panels += panels;
        modelSummary[key].powerKW += powerKW;
        modelSummary[key].areas += area;
        modelSummary[key].count += 1;
    });

    document.getElementById('polygonArea').textContent = totalArea.toFixed(2) + ' m²';
    document.getElementById('estimatedPanels').textContent = totalPanels.toLocaleString();
    document.getElementById('estimatedPower').textContent = totalPowerKW.toFixed(2) + ' kW';

    let detailEl = document.getElementById('modelDetailInfo');
    if (!detailEl) {
        const polygonSection = document.getElementById('estimatedPower').closest('.info-grid') ||
                                document.getElementById('estimatedPower').parentElement.parentElement;
        if (polygonSection) {
            detailEl = document.createElement('div');
            detailEl.id = 'modelDetailInfo';
            detailEl.style.cssText = 'margin-top:12px; padding:10px; background:rgba(59,130,246,0.1); border-radius:8px; font-size:12px;';
            polygonSection.parentElement.appendChild(detailEl);
        }
    }

    if (detailEl) {
        const modelKeys = Object.keys(modelSummary);
        if (modelKeys.length === 0) {
            detailEl.innerHTML = '';
            detailEl.style.display = 'none';
        } else {
            detailEl.style.display = 'block';
            let html = '<div style="font-weight:bold; color:#60a5fa; margin-bottom:6px;">모델별 상세</div>';
            modelKeys.forEach(model => {
                const s = modelSummary[model];
                html += `<div style="padding:4px 0; border-bottom:1px solid rgba(255,255,255,0.1);">
                    <div style="color:#a5b4fc; font-weight:bold;">${model}</div>
                    <div style="color:#d1d5db;">영역 ${s.count}개 | ${s.areas.toFixed(1)}m² | ${s.panels}장 | ${s.powerKW.toFixed(1)}kW</div>
                </div>`;
            });
            detailEl.innerHTML = html;
        }
    }
}

function updateScaleInfo() {
    const scaleInfo = document.getElementById('scaleInfo');
    if (scaleInfo) {
        let scaleText = `${config.metersPerPixel.toFixed(3)} m/픽셀`;
        if (currentLatitude !== null) {
            const latRad = currentLatitude * Math.PI / 180;
            const correction = Math.cos(latRad);
            scaleText += ` (위도 ${currentLatitude.toFixed(2)}° 보정: ${(correction * 100).toFixed(1)}%)`;
        }
        scaleInfo.value = scaleText;
    }
}

function handleImageUpload(e) {
    const file = e.target.files[0];
    if (file) {
        loadImage(file);
    }
}

function loadImage(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            uploadedImage = img;
            setupCanvas();
            document.getElementById('canvasOverlay').classList.add('hidden');

            if (currentLatitude === null || config.metersPerPixel === 0.30) {
                alert('📏 직접 업로드한 이미지입니다.\n\n정확한 면적 계산을 위해:\n1. "수동 스케일 설정" (m/픽셀)\n2. "위도" (°)\n\n두 값을 입력해주세요.\n\n💡 참고: 카카오맵에서 거리측정 후 스케일 계산 도우미를 사용하세요.');
            }
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function setupCanvas() {
    if (!uploadedImage) return;

    const maxWidth = canvas.parentElement.clientWidth - 40;
    const maxHeight = window.innerHeight - 300;

    let width = uploadedImage.width;
    let height = uploadedImage.height;

    if (width > maxWidth) {
        height = (height * maxWidth) / width;
        width = maxWidth;
    }

    if (height > maxHeight) {
        width = (width * maxHeight) / height;
        height = maxHeight;
    }

    canvas.width = width;
    canvas.height = height;

    redrawCanvas();
}

function redrawCanvas() {
    if (!uploadedImage) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(uploadedImage, 0, 0, canvas.width, canvas.height);

    drawnGrids.forEach(grid => {
        drawGrid(grid.x, grid.y, false);
    });

    drawnPolygons.forEach(polygon => {
        drawPolygon(polygon, false);
    });

    if (currentPolygon.length > 0) {
        drawPolygon(currentPolygon, true);
    }

    updateInfo();
}

function handleCanvasClick(e) {
    if (!uploadedImage) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (currentMode === 'draw') {
        drawnGrids.push({ x, y });
        drawGrid(x, y, false);
        updateInfo();
    } else if (currentMode === 'polygon') {
        handlePolygonClick(x, y);
    } else if (currentMode === 'erase') {
        removeGridAt(x, y);
        removePolygonAt(x, y);
    }
}

function handleCanvasHover(e) {
    if (!uploadedImage) return;
    if (currentMode !== 'draw' && currentMode !== 'polygon') return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    redrawCanvas();

    if (currentMode === 'draw') {
        drawGrid(x, y, true);
    } else if (currentMode === 'polygon' && currentPolygon.length > 0) {
        drawPolygonPreview(x, y);
    }
}

function drawGrid(x, y, isPreview) {
    const panelWidthM = config.panelWidth / 1000;
    const panelHeightM = config.panelHeight / 1000;
    const spacingM = config.spacing / 1000;

    let latitudeCorrectionFactor = 1.0;
    if (currentLatitude !== null) {
        const latRad = currentLatitude * Math.PI / 180;
        latitudeCorrectionFactor = Math.cos(latRad);
    }

    const panelWidthPx = (panelWidthM / config.metersPerPixel) * latitudeCorrectionFactor;
    const panelHeightPx = panelHeightM / config.metersPerPixel;
    const spacingPx = (spacingM / config.metersPerPixel) * latitudeCorrectionFactor;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((config.rotation * Math.PI) / 180);

    for (let row = 0; row < config.gridRows; row++) {
        for (let col = 0; col < config.gridCols; col++) {
            const px = col * (panelWidthPx + spacingPx);
            const py = row * (panelHeightPx + spacingPx);

            if (isPreview) {
                ctx.fillStyle = 'rgba(59, 130, 246, 0.3)';
            } else {
                ctx.fillStyle = 'rgba(59, 130, 246, 0.5)';
            }
            ctx.fillRect(px, py, panelWidthPx, panelHeightPx);

            ctx.strokeStyle = isPreview ? 'rgba(96, 165, 250, 0.6)' : 'rgba(96, 165, 250, 0.9)';
            ctx.lineWidth = isPreview ? 1 : 2;
            ctx.strokeRect(px, py, panelWidthPx, panelHeightPx);

            ctx.strokeStyle = isPreview ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 255, 255, 0.3)';
            ctx.lineWidth = 1;

            const cellRows = 4;
            const cellCols = 6;
            const cellWidth = panelWidthPx / cellCols;
            const cellHeight = panelHeightPx / cellRows;

            for (let i = 1; i < cellRows; i++) {
                ctx.beginPath();
                ctx.moveTo(px, py + i * cellHeight);
                ctx.lineTo(px + panelWidthPx, py + i * cellHeight);
                ctx.stroke();
            }

            for (let i = 1; i < cellCols; i++) {
                ctx.beginPath();
                ctx.moveTo(px + i * cellWidth, py);
                ctx.lineTo(px + i * cellWidth, py + panelHeightPx);
                ctx.stroke();
            }
        }
    }

    ctx.restore();
}

function removeGridAt(x, y) {
    const threshold = 50;
    const index = drawnGrids.findIndex(grid => {
        const distance = Math.sqrt(Math.pow(grid.x - x, 2) + Math.pow(grid.y - y, 2));
        return distance < threshold;
    });

    if (index !== -1) {
        drawnGrids.splice(index, 1);
        redrawCanvas();
        updateInfo();
    }
}

function clearAll() {
    if (drawnGrids.length === 0 && drawnPolygons.length === 0 && currentPolygon.length === 0) return;

    if (confirm('모든 그리드와 영역을 삭제하시겠습니까?')) {
        drawnGrids = [];
        drawnPolygons = [];
        currentPolygon = [];
        redrawCanvas();
        updateInfo();
    }
}

function undo() {
    if (currentPolygon.length > 0) {
        currentPolygon.pop();
        redrawCanvas();
        updateInfo();
    } else if (drawnPolygons.length > 0) {
        drawnPolygons.pop();
        redrawCanvas();
        updateInfo();
    } else if (drawnGrids.length > 0) {
        drawnGrids.pop();
        redrawCanvas();
        updateInfo();
    }
}

function updateInfo() {
    const totalPanels = drawnGrids.length * config.gridRows * config.gridCols;
    const totalPowerKW = (totalPanels * config.panelPower) / 1000;
    const gridCount = drawnGrids.length;

    const panelWidthM = config.panelWidth / 1000;
    const panelHeightM = config.panelHeight / 1000;
    const spacingM = config.spacing / 1000;

    const gridWidth = config.gridCols * panelWidthM + (config.gridCols - 1) * spacingM;
    const gridHeight = config.gridRows * panelHeightM + (config.gridRows - 1) * spacingM;
    const totalArea = gridCount * gridWidth * gridHeight;

    const elTotalPanels = document.getElementById('totalPanels');
    const elTotalPower = document.getElementById('totalPower');
    const elGridCount = document.getElementById('gridCount');
    const elTotalArea = document.getElementById('totalArea');
    if (elTotalPanels) elTotalPanels.textContent = totalPanels.toLocaleString();
    if (elTotalPower) elTotalPower.textContent = totalPowerKW.toFixed(2) + ' kW';
    if (elGridCount) elGridCount.textContent = gridCount.toLocaleString();
    if (elTotalArea) elTotalArea.textContent = totalArea.toFixed(2) + ' m²';

    updatePolygonInfo();
}

function printMapView() {
    const now = new Date();
    const dateStr = now.getFullYear() + '-' +
        String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0') + ' ' +
        String(now.getHours()).padStart(2, '0') + ':' +
        String(now.getMinutes()).padStart(2, '0');
    const modelText = getCurrentPanelModelName();
    const areaText = (document.getElementById('polygonArea') || {}).textContent || '0 m²';
    const panelsText = (document.getElementById('estimatedPanels') || {}).textContent || '0';
    const powerText = (document.getElementById('estimatedPower') || {}).textContent || '0 kW';

    let printHeader = document.getElementById('printHeader');
    if (!printHeader) {
        printHeader = document.createElement('div');
        printHeader.id = 'printHeader';
        document.body.prepend(printHeader);
    }
    printHeader.innerHTML = `
        <div style="font-size:22px;font-weight:700;margin-bottom:6px;">태양광 패널 설계 보고서</div>
        <div style="font-size:13px;color:#4b5563;margin-bottom:2px;">인쇄일: ${dateStr}</div>
        <div style="font-size:13px;color:#4b5563;">모델: ${modelText} | 면적: ${areaText} | 패널: ${panelsText} | 용량: ${powerText}</div>
    `;

    let printSummary = document.getElementById('printSummary');
    if (!printSummary) {
        printSummary = document.createElement('div');
        printSummary.id = 'printSummary';
        const canvasContainer = document.querySelector('.canvas-container');
        if (canvasContainer && canvasContainer.parentNode) {
            canvasContainer.parentNode.insertBefore(printSummary, canvasContainer.nextSibling);
        } else {
            document.body.appendChild(printSummary);
        }
    }
    const modelStats = {};
    mapPolygonData.forEach((item) => {
        if (!item || !item.path || !item.panelInfo) return;
        const area = calculateMapPolygonArea(item.path);
        const panelWidthM = parseFloat(item.panelInfo.width || 0) / 1000;
        const panelHeightM = parseFloat(item.panelInfo.height || 0) / 1000;
        const panelArea = panelWidthM * panelHeightM;
        if (!(panelArea > 0)) return;

        const modelName = item.panelInfo.modelName || item.panelInfo.shortName || '커스텀 모델';
        const panels = Math.floor((area * 0.7) / panelArea);
        const powerKW = (panels * parseFloat(item.panelInfo.power || 0)) / 1000;

        if (!modelStats[modelName]) {
            modelStats[modelName] = { area: 0, panels: 0, powerKW: 0 };
        }
        modelStats[modelName].area += area;
        modelStats[modelName].panels += panels;
        modelStats[modelName].powerKW += powerKW;
    });

    const modelEntries = Object.entries(modelStats);
    if (modelEntries.length > 0) {
        const rows = modelEntries.map(([name, stat]) => `
            <tr>
                <td>${name}</td>
                <td>${stat.area.toFixed(2)} m²</td>
                <td>${stat.panels.toLocaleString()}</td>
                <td>${stat.powerKW.toFixed(2)} kW</td>
            </tr>
        `).join('');
        printSummary.innerHTML = `
            <div class="print-summary-title">영역 정보 (모델별)</div>
            <table class="print-summary-table">
                <thead>
                    <tr>
                        <th>모델</th>
                        <th>면적</th>
                        <th>예상 패널 수</th>
                        <th>예상 설치 용량</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        `;
    } else {
        printSummary.innerHTML = `
            <div class="print-summary-grid">
                <div class="print-summary-item"><div class="k">모델</div><div class="v">${modelText}</div></div>
                <div class="print-summary-item"><div class="k">영역 면적</div><div class="v">${areaText}</div></div>
                <div class="print-summary-item"><div class="k">예상 패널 수</div><div class="v">${panelsText}</div></div>
                <div class="print-summary-item"><div class="k">예상 설치 용량</div><div class="v">${powerText}</div></div>
            </div>
        `;
    }

    let printStyle = document.getElementById('printStyle');
    if (!printStyle) {
        printStyle = document.createElement('style');
        printStyle.id = 'printStyle';
        document.head.appendChild(printStyle);
    }

    printStyle.textContent = `
        #printHeader, #printSummary { display: none; }
        @media print {
            body { margin: 0 !important; background: #fff !important; }
            .control-panel, .info-panel, header, #mapControlBar, #mapGuide, .canvas-overlay { display: none !important; }
            .main-content, .container, .canvas-container { width: 100% !important; max-width: 100% !important; margin: 0 !important; padding: 0 !important; }
            #printHeader { display: block !important; padding: 10mm 10mm 6mm 10mm; }
            #kakaoMapWrapper { height: 160mm !important; border-radius: 0 !important; page-break-inside: avoid !important; break-inside: avoid !important; overflow: hidden !important; }
            #canvas { width: 100% !important; height: auto !important; }
            #printSummary { display: block !important; padding: 6mm 10mm 8mm 10mm; page-break-inside: avoid !important; break-inside: avoid !important; }
            #printSummary .print-summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
            #printSummary .print-summary-item { border: 1px solid #d1d5db; border-radius: 6px; padding: 8px; }
            #printSummary .k { font-size: 11px; color: #6b7280; margin-bottom: 2px; }
            #printSummary .v { font-size: 14px; font-weight: 700; color: #111827; word-break: break-word; }
            #printSummary .print-summary-title { font-size: 14px; font-weight: 700; margin-bottom: 8px; }
            #printSummary .print-summary-table { width: 100%; border-collapse: collapse; }
            #printSummary .print-summary-table th, #printSummary .print-summary-table td { border: 1px solid #d1d5db; padding: 6px 8px; font-size: 12px; text-align: left; }
            #printSummary .print-summary-table th { background: #f3f4f6; font-weight: 700; }
            @page { size: A4 portrait; margin: 8mm; }
        }
    `;

    setTimeout(() => window.print(), 100);
}

function handlePolygonClick(x, y) {
    currentPolygon.push({ x, y });

    if (currentPolygon.length === 4) {
        drawnPolygons.push([...currentPolygon]);
        currentPolygon = [];
    }

    redrawCanvas();
    updateInfo();
}

function drawPolygon(points, isCurrentDrawing) {
    if (points.length === 0) return;

    ctx.save();

    points.forEach((point, index) => {
        ctx.beginPath();
        ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = isCurrentDrawing ? 'rgba(245, 158, 11, 0.8)' : 'rgba(16, 185, 129, 0.8)';
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = 'white';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(index + 1, point.x, point.y);
    });

    if (points.length > 1) {
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            ctx.lineTo(points[i].x, points[i].y);
        }

        if (points.length === 4) {
            ctx.closePath();
            ctx.fillStyle = isCurrentDrawing ? 'rgba(245, 158, 11, 0.2)' : 'rgba(16, 185, 129, 0.2)';
            ctx.fill();
        }

        ctx.strokeStyle = isCurrentDrawing ? 'rgba(245, 158, 11, 0.9)' : 'rgba(16, 185, 129, 0.9)';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    ctx.restore();
}

function drawPolygonPreview(x, y) {
    if (currentPolygon.length === 0) return;

    ctx.save();

    ctx.beginPath();
    ctx.moveTo(currentPolygon[currentPolygon.length - 1].x, currentPolygon[currentPolygon.length - 1].y);
    ctx.lineTo(x, y);
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.5)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.stroke();
    ctx.setLineDash([]);

    if (currentPolygon.length === 3) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(currentPolygon[0].x, currentPolygon[0].y);
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.5)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    ctx.restore();
}

function calculatePolygonArea(points) {
    if (points.length < 3) return 0;

    let latitudeCorrectionFactor = 1.0;
    if (currentLatitude !== null) {
        const latRad = currentLatitude * Math.PI / 180;
        latitudeCorrectionFactor = Math.cos(latRad);
    }

    let area = 0;
    const n = points.length;

    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const xi = points[i].x * config.metersPerPixel * latitudeCorrectionFactor;
        const yi = points[i].y * config.metersPerPixel;
        const xj = points[j].x * config.metersPerPixel * latitudeCorrectionFactor;
        const yj = points[j].y * config.metersPerPixel;

        area += xi * yj;
        area -= xj * yi;
    }

    return Math.abs(area / 2);
}

function updatePolygonInfo() {
    const mapWrapper = document.getElementById('kakaoMapWrapper');
    if (mapWrapper && mapPolygonData.length > 0) {
        updateMapAreaInfo();
        return;
    }

    let totalPolygonArea = 0;

    drawnPolygons.forEach(polygon => {
        totalPolygonArea += calculatePolygonArea(polygon);
    });

    if (currentPolygon.length === 4) {
        totalPolygonArea += calculatePolygonArea(currentPolygon);
    }

    const panelWidthM = config.panelWidth / 1000;
    const panelHeightM = config.panelHeight / 1000;
    const panelArea = panelWidthM * panelHeightM;

    const efficiency = 0.7;
    const estimatedPanels = Math.floor((totalPolygonArea * efficiency) / panelArea);
    const estimatedPowerKW = (estimatedPanels * config.panelPower) / 1000;

    document.getElementById('polygonArea').textContent = totalPolygonArea.toFixed(2) + ' m²';
    document.getElementById('estimatedPanels').textContent = estimatedPanels.toLocaleString();
    document.getElementById('estimatedPower').textContent = estimatedPowerKW.toFixed(2) + ' kW';
}

function removePolygonAt(x, y) {
    const threshold = 15;

    for (let i = drawnPolygons.length - 1; i >= 0; i--) {
        const polygon = drawnPolygons[i];
        for (let j = 0; j < polygon.length; j++) {
            const point = polygon[j];
            const distance = Math.sqrt(Math.pow(point.x - x, 2) + Math.pow(point.y - y, 2));
            if (distance < threshold) {
                drawnPolygons.splice(i, 1);
                redrawCanvas();
                updateInfo();
                return;
            }
        }
    }

    for (let i = currentPolygon.length - 1; i >= 0; i--) {
        const point = currentPolygon[i];
        const distance = Math.sqrt(Math.pow(point.x - x, 2) + Math.pow(point.y - y, 2));
        if (distance < threshold) {
            currentPolygon.splice(i, 1);
            redrawCanvas();
            updateInfo();
            return;
        }
    }
}
