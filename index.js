import {
    eventSource,
    event_types,
    saveSettingsDebounced,
    saveChat,
    characters,
    this_chid,
    getThumbnailUrl
} from '../../../../script.js';

import {
    getContext,
    extension_settings,
    loadExtensionSettings
} from '../../../extensions.js';

import {
    user_avatar
} from '../../../personas.js';

const extensionName = 'Popupmemo';
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;
const DEFAULT_AVATAR_PATH = '/img/five.png';

let charBubbleTimer;
let charCurrentBubbleIndex = 0;
let userBubbleTimer;
let userCurrentBubbleIndex = 0;
let isTabEditMode = false;

const DEFAULT_SETTINGS = {
    enabled: true,
    showWandButton: true,
    ignoreClick: false,
    useCharacterStorage: false,
    
    pos: { top: 50, left: 50 },
    width: 350,
    height: 250,
    bgOpacity: 0.7,
    bgImage: '',
    
    charBubbleColor: '#FFFFFF', 
    userBubbleColor: '#F0F0F0', 
    
    charBubbles: ['', '', ''],
    userBubbles: ['', '', ''],
    
    charData: {}
};
let settings;

// 안전한 알림 함수
function showToast(type, message) {
    if (window.toastr && typeof window.toastr[type] === 'function') {
        window.toastr[type](message);
    } else {
        console.log(`[PopupMemo ${type}]: ${message}`);
    }
}

async function addToWandMenu() {
    try {
        if ($('#popupmemo_wand_button').length > 0) return;

        const buttonHtml = await $.get(`${extensionFolderPath}/button.html`);
        const extensionsMenu = $("#extensionsMenu");
        
        if (extensionsMenu.length > 0) {
            extensionsMenu.append(buttonHtml);
            $("#popupmemo_wand_button").on("click", function() {
                toggleMemoEnabled();
            });
            updateWandMenuVisibility();
            updateWandButtonStatus();
        } else {
            setTimeout(addToWandMenu, 1000);
        }
    } catch (error) {
        console.warn('[PopupMemo] Failed to add wand button:', error);
    }
}

function updateWandMenuVisibility() {
    if (settings.showWandButton) {
        $("#popupmemo_wand_button").show();
    } else {
        $("#popupmemo_wand_button").hide();
    }
}

function updateWandButtonStatus() {
    const $statusIcon = $("#popupmemo_status_icon");
    const $mainIcon = $("#popupmemo_wand_button .extensionsMenuExtensionButton");
    
    if ($statusIcon.length > 0) {
        if (settings.enabled) {
            $statusIcon.removeClass("fa-toggle-off").addClass("fa-toggle-on");
            $statusIcon.css("color", "#4CAF50");
            $statusIcon.css("opacity", "1");
            $mainIcon.css("opacity", "1");
        } else {
            $statusIcon.removeClass("fa-toggle-on").addClass("fa-toggle-off");
            $statusIcon.css("color", "#888");
            $statusIcon.css("opacity", "0.5");
            $mainIcon.css("opacity", "0.5");
        }
    }
}

function toggleMemoEnabled() {
    settings.enabled = !settings.enabled;
    const $toggleCheckbox = $('#memo_enable_toggle');
    if ($toggleCheckbox.length > 0) {
        $toggleCheckbox.prop('checked', settings.enabled);
    }
    applySettings();
    saveSettingsDebounced();
    const msg = settings.enabled ? '팝업 메모장이 활성화되었습니다.' : '팝업 메모장이 비활성화되었습니다.';
    showToast('info', msg);
}

function createMemoPopup() {
    $('#popup-memo-container').remove();

    const memoHTML = `
        <div id="popup-memo-container">
            <div id="memo-tabs-container"></div>
            <div id="memo-header">
                <div id="memo-profile-area">
                    <img id="memo-char-avatar" src="${DEFAULT_AVATAR_PATH}" alt="Character Avatar">
                    <div id="memo-bubble-display" class="speech-bubble-container">
                        <span class="speech-bubble" id="memo-bubble-content"></span>
                    </div>
                </div>
                <div id="memo-controls-area">
                    <button id="memo-toggle-ignore" class="memo-control-btn" title="클릭 무시 토글 (드래그 불가)">
                        <i class="fa-solid fa-hand-pointer"></i>
                    </button>
                </div>
            </div>
            <textarea id="popup-memo-textarea" placeholder="메모를 작성하세요."></textarea>
            <div id="memo-resize-handle"></div>
            <div id="memo-user-area">
                <div id="memo-user-bubble-display" class="speech-bubble-container user-speech-bubble-container">
                    <span class="speech-bubble user-speech-bubble" id="memo-user-bubble-content"></span>
                </div>
                <img id="memo-user-avatar" src="${DEFAULT_AVATAR_PATH}" alt="User Avatar">
            </div>
        </div>
    `;
    $('body').append(memoHTML);

    const $memoContainer = $('#popup-memo-container');
    const $memoTextarea = $('#popup-memo-textarea');

    $('#memo-toggle-ignore').on('click', toggleIgnoreClick);
    $memoTextarea.on('input', saveMemoContentDebounced);

    bindDragFunctionality($memoContainer);
    
    $memoTextarea.on('mousedown', (e) => {
        // 텍스트 영역 클릭 시 탭 수정 팝업이 열려있다면 닫기
        $('#memo-tab-edit-popup').remove();
        e.stopPropagation();
    });

    $memoContainer.on('mouseup', function() {
        if (window.innerWidth > 768) {
            const currentWidth = $memoContainer.width();
            const currentHeight = $memoContainer.height();
            if (settings.width !== currentWidth || settings.height !== currentHeight) {
                settings.width = currentWidth;
                settings.height = currentHeight;
                saveSettingsDebounced();
            }
        }
    });
    
    $(window).on('resize', function() {
        if (settings.enabled && window.innerWidth <= 768) {
            applySettings();
        }
    });
}

function bindDragFunctionality($element) {
    let isDragging = false;
    let isResizing = false;
    let startX, startY, startW, startH;
    let initialLeft, initialTop;
    const container = $element[0];

    $element.on('mousedown', '#memo-resize-handle', function(e) {
        isResizing = true;
        startX = e.clientX;
        startY = e.clientY;
        startW = $element.width();
        startH = $element.height();
        e.stopPropagation();
        e.preventDefault();
    });

    function onDragStart(e) {
        if (window.innerWidth <= 768 || isResizing) return;
        if ($(e.target).closest('#memo-controls-area').length || 
            $(e.target).closest('#memo-tabs-container').length || 
            $(e.target).is('#popup-memo-textarea') || 
            $(e.target).is('#memo-resize-handle')) return;
        
        isDragging = true;
        $element.addClass('grabbing');
        startX = e.clientX;
        startY = e.clientY;
        initialLeft = container.offsetLeft;
        initialTop = container.offsetTop;
    }

    $(document).on('mousemove', function(e) {
        if (isResizing) {
            const newWidth = startW + (e.clientX - startX);
            const newHeight = startH + (e.clientY - startY);
            $element.css({ width: Math.max(280, newWidth), height: Math.max(200, newHeight) });
            settings.width = $element.width();
            settings.height = $element.height();
        } else if (isDragging) {
            let newLeft = initialLeft + (e.clientX - startX);
            let newTop = initialTop + (e.clientY - startY);
            container.style.left = `${newLeft}px`;
            container.style.top = `${newTop}px`;
            settings.pos = { left: newLeft, top: newTop };
        }
    });

    $(document).on('mouseup', function() {
        if (isDragging || isResizing) {
            isDragging = false;
            isResizing = false;
            $element.removeClass('grabbing');
            saveSettingsDebounced();
        }
    });

    $element.on('mousedown', onDragStart);
}

function getCharacterKey(chid) {
    if (chid === undefined || chid === null || chid === -1) return null;
    const char = characters[chid];
    if (!char) return null;
    return char.avatar || char.name;
}

function getCurrentCharData() {
    const charKey = getCharacterKey(this_chid) || 'no_char_selected'; 
    if (!settings.charData) settings.charData = {}; 

    if (!settings.charData[charKey]) {
        settings.charData[charKey] = {
            charBubbles: ['', '', ''], 
            charImageOverride: '',
            userCharBubbles: ['', '', ''], 
            userImageOverride: '',
            tabs: [{ name: '기본 메모', content: '', color: '#ffffff' }],
            activeTabIndex: 0
        };
    }
    
    const data = settings.charData[charKey];

    // 필수 필드 보정
    if (!data.charBubbles) data.charBubbles = ['', '', ''];
    if (!data.userCharBubbles) data.userCharBubbles = ['', '', ''];
    
    // [보정] 탭 데이터가 없거나 형식이 잘못된 경우 복구
    if (!data.tabs || !Array.isArray(data.tabs) || data.tabs.length === 0) {
        const legacyContent = data.memoContent || '';
        data.tabs = [{ name: '기본 메모', content: legacyContent, color: '#ffffff' }];
        data.activeTabIndex = 0;
    }

    // [보정] 첫 번째 탭(기본 메모)의 이름이 비어있거나 삭제된 경우 강제 생성
    if (!data.tabs[0] || data.tabs[0].name === undefined) {
        data.tabs.unshift({ name: '기본 메모', content: '', color: '#ffffff' });
    }

    if (data.activeTabIndex === undefined || data.activeTabIndex >= data.tabs.length) {
        data.activeTabIndex = 0;
    }
    return data;
}

function applySettings() {
    const $memoContainer = $('#popup-memo-container');
    const $memoTextarea = $('#popup-memo-textarea');
    const $toggleBtn = $('#memo-toggle-ignore');
    const charData = getCurrentCharData();

    updateWandButtonStatus();
    if ($memoContainer.length === 0) return;

    $memoContainer.toggle(!!settings.enabled);
    const isMobile = window.innerWidth <= 768;

    if (!settings.pos || isNaN(settings.pos.top) || isNaN(settings.pos.left)) {
        settings.pos = { top: 50, left: 50 };
    }

    if (isMobile) {
        const $chat = $('#chat');
        if ($chat.length > 0) {
            const rect = $chat[0].getBoundingClientRect();
            $memoContainer.css({
                'top': rect.top + 'px',
                'height': rect.height + 'px',
                'left': '50%',
                'width': '98%',
                'min-width': 'unset',
                'min-height': 'unset'
            });
        }
    } else {
        $memoContainer.css({
            top: `${settings.pos.top}px`,
            left: `${settings.pos.left}px`,
            width: `${settings.width}px`,
            height: `${settings.height}px`, 
            'transform': 'none',
            'display': 'flex'
        });
    }

    renderTabs();
    
    let savedMemo = '';
    if (settings.useCharacterStorage) {
        const activeTab = charData.tabs[charData.activeTabIndex] || charData.tabs[0];
        savedMemo = activeTab.content || '';
    } else {
        savedMemo = getChatMemoData();
    }

    $memoTextarea.val(savedMemo); 
    
    const individualCharBubbles = charData.charBubbles.filter(b => b.trim() !== '');
    let charBubblesToDisplay = individualCharBubbles.length > 0 ? charData.charBubbles : settings.charBubbles;
    
    const individualUserBubbles = charData.userCharBubbles.filter(b => b.trim() !== '');
    let userBubblesToDisplay = individualUserBubbles.length > 0 ? charData.userCharBubbles : settings.userBubbles;
    
    $memoContainer.get(0).style.setProperty('--char-bubble-color', settings.charBubbleColor);
    $('#memo-bubble-display').css('background-color', settings.charBubbleColor);
    
    $memoContainer.get(0).style.setProperty('--user-bubble-color', settings.userBubbleColor);
    $('#memo-user-bubble-display').css('background-color', settings.userBubbleColor);

    updateBubbleDisplay(charBubblesToDisplay, '#memo-bubble-content'); 
    updateBubbleDisplay(userBubblesToDisplay, '#memo-user-bubble-content'); 

    $memoContainer.toggleClass('ignore-click', settings.ignoreClick);
    $toggleBtn.toggleClass('active', settings.ignoreClick); 

    applyBackgroundStyle();
    updateProfileImages(); 
    renderCharMemoList();
}

function applyBackgroundStyle() {
    const $memoContainer = $('#popup-memo-container');
    const opacity = settings.bgOpacity || 0.7;
    const imageURL = settings.bgImage;

    $memoContainer.css({
        'background-color': `rgba(255, 255, 255, ${opacity})`,
        'background-image': imageURL ? `url(${imageURL})` : 'none',
        'background-size': 'cover',
        'background-position': 'center',
        'background-blend-mode': 'overlay',
        'backdrop-filter': imageURL ? 'none' : 'blur(5px)',
    });
}

function updateProfileImages() {
    const charId = this_chid;
    const currentCharCard = characters[charId]; 
    const charData = getCurrentCharData();

    // 캐릭터 이미지 결정
    let charPath = DEFAULT_AVATAR_PATH;
    if (charData.charImageOverride && charData.charImageOverride.trim() !== '') { 
        charPath = charData.charImageOverride.trim();
    } else if (currentCharCard && currentCharCard.avatar) {
        charPath = `/thumbnail?type=avatar&file=${currentCharCard.avatar}`;
    }
    
    // 사용자(페르소나) 이미지 결정
    let personaPath = DEFAULT_AVATAR_PATH;
    if (charData.userImageOverride && charData.userImageOverride.trim() !== '') { 
        personaPath = charData.userImageOverride.trim();
    } else {
        // user_avatar 변수를 직접 참조하고 없을 경우 대체값 확인
        const personaFileName = typeof user_avatar !== 'undefined' ? user_avatar : null;
        if (personaFileName) {
            if (typeof getThumbnailUrl === 'function') {
                personaPath = getThumbnailUrl('persona', personaFileName, true); 
            } else {
                personaPath = `/thumbnail?type=persona&file=${personaFileName}`; 
            }
        }
    }
    
    $('#memo-char-avatar').attr('src', charPath);
    $('#memo-user-avatar').attr('src', personaPath);
}

function startBubbleRotation(bubbles, contentSelector, timerRef, indexRef) {
    const $bubbleContent = $(contentSelector);
    const $bubbleContainer = $bubbleContent.parent();

    if (timerRef) clearInterval(timerRef);
    if (!Array.isArray(bubbles)) return { timer: null, index: 0 };

    const validBubbles = bubbles.filter(b => b && b.trim() !== '');

    if (validBubbles.length === 0) {
        $bubbleContent.text('').css('opacity', 0);
        $bubbleContainer.removeClass('bubble-flicker-in bubble-flicker-out');
        return { timer: null, index: 0 };
    }

    if (validBubbles.length <= 1) {
        $bubbleContent.text(validBubbles[0]).css('opacity', 1);
        $bubbleContainer.removeClass('bubble-flicker-in bubble-flicker-out');
        return { timer: null, index: 0 }; 
    }

    let currentIndex = indexRef;
    const rotateBubble = () => {
        const text = validBubbles[currentIndex];
        $bubbleContainer.addClass('bubble-flicker-out');
        
        setTimeout(() => {
            $bubbleContent.text(text).css('opacity', 1);
            $bubbleContainer.removeClass('bubble-flicker-out').addClass('bubble-flicker-in');
            setTimeout(() => $bubbleContainer.removeClass('bubble-flicker-in'), 500); 
            currentIndex = (currentIndex + 1) % validBubbles.length;
        }, 300); 
    };

    rotateBubble();
    const newTimer = setInterval(rotateBubble, 7000); 
    return { timer: newTimer, index: currentIndex };
}

function updateBubbleDisplay(bubbles, contentSelector) {
    if (contentSelector === '#memo-bubble-content') { 
        const { timer, index } = startBubbleRotation(bubbles, contentSelector, charBubbleTimer, charCurrentBubbleIndex);
        charBubbleTimer = timer;
        charCurrentBubbleIndex = index;
    } else if (contentSelector === '#memo-user-bubble-content') { 
        const { timer, index } = startBubbleRotation(bubbles, contentSelector, userBubbleTimer, userCurrentBubbleIndex);
        userBubbleTimer = timer;
        userCurrentBubbleIndex = index;
    }
}

function debounce(func, wait) {
    let timeout;
    return function(...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), wait);
    };
}

function getChatMemoData() {
    const context = getContext();
    if (!context.chat || context.chat.length === 0) return '';
    const firstMes = context.chat[0];
    if (!firstMes.extra) firstMes.extra = {};
    return firstMes.extra.popupmemo_content || '';
}

const saveMemoContentDebounced = debounce(async () => {
    const content = $('#popup-memo-textarea').val();
    
    if (settings.useCharacterStorage) {
        if (this_chid === undefined || this_chid === -1) return;
        const charData = getCurrentCharData();
        const activeIdx = charData.activeTabIndex || 0;
        
        if (charData.tabs[activeIdx]) {
            charData.tabs[activeIdx].content = content;
            if (activeIdx === 0) charData.memoContent = content;
        }
        saveSettingsDebounced();
        // 리스트 즉시 갱신
        renderCharMemoList();
    } else {
        const context = getContext();
        if (context.chat && context.chat.length > 0) {
            const firstMes = context.chat[0];
            if (!firstMes.extra) firstMes.extra = {};
            if (firstMes.extra.popupmemo_content !== content) {
                firstMes.extra.popupmemo_content = content;
                await saveChat();
            }
        }
    }
}, 500);

function toggleIgnoreClick() {
    settings.ignoreClick = !settings.ignoreClick;
    applySettings(); 
    saveSettingsDebounced();
}

function renderCharMemoList() {
    const $container = $('#memo_char_list_container');
    if ($container.length === 0) return;
    $container.empty();

    if (!settings.charData) return;

    const charEntries = Object.entries(settings.charData)
        .filter(([charKey, data]) => {
            return charKey !== 'no_char_selected' && (
                (data.tabs && data.tabs.some(t => t.content && t.content.trim() !== '')) || 
                (data.memoContent && data.memoContent.trim() !== '')
            );
        });

    if (charEntries.length === 0) {
        $container.append('<div style="text-align: center; color: #999; padding: 20px;">저장된 캐릭터 데이터가 없습니다.</div>');
        return;
    }

    charEntries.forEach(([charKey, data]) => {
        const charCard = characters.find(c => c.avatar === charKey || c.name === charKey);
        const charName = charCard ? charCard.name : `(미설치: ${charKey})`;
        const tabCount = data.tabs ? data.tabs.length : 1;
        
        let memoPreview = '(메모 없음)';
        const firstTab = data.tabs ? data.tabs[0] : null;
        if (firstTab && firstTab.content) {
            const firstLine = firstTab.content.trim().split('\n')[0];
            memoPreview = firstLine.substring(0, 50) + (firstLine.length > 50 ? '...' : '');
        } else if (data.memoContent) {
            const firstLine = data.memoContent.trim().split('\n')[0];
            memoPreview = firstLine.substring(0, 50) + (firstLine.length > 50 ? '...' : '');
        }

        const listItem = `
            <div class="memo-list-item" data-char-key="${charKey}" style="border-left: 4px solid #6b82d8;">
                <div class="memo-list-item-content">
                    <div style="font-weight:bold; color:#555;">${charName} <span style="font-size:0.8em; color:#6b82d8; font-weight:normal;">(${tabCount} 탭)</span></div>
                    <div style="font-size:0.85em; color:#777; margin-top:2px;">${memoPreview}</div>
                </div>
                <div class="memo-btn-group">
                    <button class="memo-copy-btn" data-char-key="${charKey}" title="메모 복사"><i class="fa-solid fa-copy"></i></button>
                    <button class="memo-migrate-btn" data-char-key="${charKey}" title="가져오기"><i class="fa-solid fa-file-import"></i></button>
                    <button class="memo-delete-btn" data-char-key="${charKey}" title="삭제"><i class="fa-solid fa-trash-can"></i></button>
                </div>
            </div>`;
        $container.append(listItem);
    });
    
    $('.memo-copy-btn').off('click').on('click', copyCharMemo);
    $('.memo-migrate-btn').off('click').on('click', migrateCharMemo);
    $('.memo-delete-btn').off('click').on('click', deleteCharMemo);
}

function copyCharMemo(e) {
    const charKey = $(e.currentTarget).data('charKey');
    const data = settings.charData[charKey];
    if (data && data.tabs) {
        const allTabsContent = data.tabs.map(tab => `[${tab.name}]\n${tab.content || ''}`).join('\n\n---\n\n');
        navigator.clipboard.writeText(allTabsContent).then(() => showToast('success', '클립보드에 복사되었습니다.'));
    }
}

function migrateCharMemo(e) {
    const oldCharKey = $(e.currentTarget).data('charKey');
    const currentCharKey = getCharacterKey(this_chid);
    
    if (!currentCharKey) {
        showToast('error', '캐릭터를 먼저 선택해주세요.');
        return;
    }
    if (oldCharKey === currentCharKey) {
        showToast('info', '현재 활성화된 캐릭터입니다.');
        return;
    }
    
    if (!confirm('이 캐릭터의 모든 탭 정보를 현재 캐릭터로 가져오시겠습니까? 현재 메모가 덮어씌워지며 기존 데이터는 삭제됩니다.')) return;

    // 데이터 복사
    settings.charData[currentCharKey] = JSON.parse(JSON.stringify(settings.charData[oldCharKey]));
    
    // 원본 데이터 삭제 (이동 처리)
    delete settings.charData[oldCharKey];
    
    saveSettingsDebounced();
    applySettings(); // UI 및 텍스트 영역 즉시 갱신
    renderCharMemoList(); // 목록 갱신
    showToast('success', '데이터를 성공적으로 이동했습니다.');
}
function deleteCharMemo(e) {
    const charKeyToDelete = $(e.currentTarget).data('charKey');
    if (confirm('정말로 이 캐릭터의 모든 데이터를 삭제하시겠습니까?')) {
        delete settings.charData[charKeyToDelete];
        saveSettingsDebounced();
        renderCharMemoList();
    }
}

function onSettingChange() {
    const charData = getCurrentCharData();
    settings.enabled = $('#memo_enable_toggle').prop('checked');
    const prevMode = settings.useCharacterStorage;
    settings.useCharacterStorage = $('#memo_storage_mode_toggle').prop('checked');
    
    if (prevMode !== settings.useCharacterStorage) applySettings();

    settings.showWandButton = $('#memo_show_wand_button').prop('checked');
    settings.bgOpacity = parseFloat($('#memo_bg_opacity_input').val()) || 0.7;
    settings.bgImage = $('#memo_bg_image_input').val().trim();
    settings.charBubbleColor = $('#memo_char_bubble_color_input').val().trim() || '#FFFFFF';
    settings.userBubbleColor = $('#memo_user_bubble_color_input').val().trim() || '#F0F0F0';
    
    charData.userImageOverride = $('#memo_user_image_override').val().trim();
    charData.charImageOverride = $('#memo_char_image_override').val().trim();

    settings.charBubbles = $('.memo-global-char-bubble-input').map(function() { return $(this).val(); }).get();
    settings.userBubbles = $('.memo-global-user-bubble-input').map(function() { return $(this).val(); }).get();
    charData.charBubbles = $('.memo-char-bubble-input').map(function() { return $(this).val(); }).get();
    charData.userCharBubbles = $('.memo-user-char-bubble-input').map(function() { return $(this).val(); }).get();

    updateWandMenuVisibility();
    applySettings();
    saveSettingsDebounced();
}

function loadSettingsToUI() {
    const charData = getCurrentCharData();
    const isCharSelected = this_chid !== undefined && this_chid !== -1 && characters[this_chid];
    const charName = isCharSelected ? characters[this_chid].name : '캐릭터 미선택';

    $('#memo_enable_toggle').prop('checked', settings.enabled);
    $('#memo_storage_mode_toggle').prop('checked', settings.useCharacterStorage);
    $('#memo_show_wand_button').prop('checked', settings.showWandButton);
    $('#memo_bg_opacity_input').val(settings.bgOpacity);
    $('#memo_bg_image_input').val(settings.bgImage);
    $('#memo_char_bubble_color_input').val(settings.charBubbleColor);
    $('#memo_user_bubble_color_input').val(settings.userBubbleColor);
    $('#memo_current_char_name').text(charName);

    if (isCharSelected) {
        $('#memo_override_container').show();
        $('#memo_no_char_message').hide();
        $('#memo_user_image_override').val(charData.userImageOverride);
        $('#memo_char_image_override').val(charData.charImageOverride);
        (charData.charBubbles || ['', '', '']).forEach((b, i) => $(`#memo_char_bubble_${i + 1}`).val(b));
        (charData.userCharBubbles || ['', '', '']).forEach((b, i) => $(`#memo_user_char_bubble_${i + 1}`).val(b));
    } else {
        $('#memo_override_container').hide();
        $('#memo_no_char_message').show();
    }

    settings.charBubbles.forEach((b, i) => $(`#memo_global_char_bubble_${i + 1}`).val(b));
    settings.userBubbles.forEach((b, i) => $(`#memo_global_user_bubble_${i + 1}`).val(b));
    renderCharMemoList();
}

function onCharacterChange() {
    loadSettingsToUI(); 
    applySettings(); 
}

function isCharDataEmpty(data) {
    if (!data) return true;

    // 1. 탭 내용이 하나라도 있는지 확인
    const hasTabsContent = data.tabs && data.tabs.some(t => t.content && t.content.trim() !== '');
    
    // 2. 개별 캐릭터 대사가 설정되어 있는지 확인
    const hasCharBubbles = data.charBubbles && data.charBubbles.some(b => b && b.trim() !== '');
    const hasUserCharBubbles = data.userCharBubbles && data.userCharBubbles.some(b => b && b.trim() !== '');
    
    // 3. 이미지 오버라이드 설정이 있는지 확인
    const hasCharOverride = data.charImageOverride && data.charImageOverride.trim() !== '';
    const hasUserOverride = data.userImageOverride && data.userImageOverride.trim() !== '';

    // 위 항목 중 하나라도 해당되면 비어있지 않은 데이터임
    return !(hasTabsContent || hasCharBubbles || hasUserCharBubbles || hasCharOverride || hasUserOverride);
}

function exportSettings() {
    // 전체 설정을 깊은 복사
    const exportData = JSON.parse(JSON.stringify(settings));
    
    // charData가 존재한다면 필터링 진행
    if (exportData.charData) {
        const filteredCharData = {};
        
        for (const [key, data] of Object.entries(exportData.charData)) {
            // 'no_char_selected' 키이거나 데이터가 비어있다면 제외
            if (key === 'no_char_selected') continue;
            
            if (!isCharDataEmpty(data)) {
                filteredCharData[key] = data;
            }
        }
        
        // 필터링된 데이터로 교체
        exportData.charData = filteredCharData;
    }

    // 파일 다운로드 로직
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `popupmemo_backup_${new Date().toISOString().slice(0,10)}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
}

function renderTabs() {
    const charData = getCurrentCharData();
    const $container = $('#memo-tabs-container');
    if (!$container.length) return;

    $container.empty();
    if (!settings.useCharacterStorage) {
        $container.hide();
        return;
    }
    $container.show();

    charData.tabs.forEach((tab, index) => {
        const isActive = index === charData.activeTabIndex;
        const tabColor = tab.color || (isActive ? '#ffffff' : 'rgba(240, 240, 240, 0.85)');
        
        const $tab = $(`
            <div class="memo-tab ${isActive ? 'active' : ''}" data-index="${index}" style="--tab-bg: ${tabColor}">
                ${isTabEditMode ? '<i class="fa-solid fa-pen memo-tab-edit-icon"></i>' : ''}
                <span class="memo-tab-name">${tab.name}</span>
                ${(isTabEditMode && charData.tabs.length > 1) ? '<i class="fa-solid fa-xmark memo-tab-close"></i>' : ''}
            </div>
        `);

        $tab.on('click', (e) => {
            if (isTabEditMode && ($(e.target).hasClass('memo-tab-edit-icon') || $(e.target).hasClass('fa-pen'))) {
                openTabSettings(e, index);
            } else if ($(e.target).hasClass('memo-tab-close') || $(e.target).hasClass('fa-xmark')) {
                deleteTab(index);
            } else {
                switchTab(index);
            }
        });
        $container.append($tab);
    });

    const $tools = $(`
        <div class="memo-tab-tools">
            ${isTabEditMode ? '<div class="memo-tab-tool-btn memo-tab-add" title="새 탭 추가"><i class="fa-solid fa-plus"></i></div>' : ''}
            <div class="memo-tab-tool-btn memo-tab-edit-toggle ${isTabEditMode ? 'active' : ''}" title="탭 편집 모드">
                <i class="fa-solid fa-gear"></i>
            </div>
        </div>
    `);

    $tools.find('.memo-tab-add').on('click', (e) => { e.stopPropagation(); addTab(); });
    $tools.find('.memo-tab-edit-toggle').on('click', (e) => {
        e.stopPropagation();
        isTabEditMode = !isTabEditMode;
        renderTabs();
    });
    $container.append($tools);
}

function openTabSettings(e, index) {
    e.preventDefault(); 
    e.stopPropagation(); // 탭 전환 이벤트 전파 방지
    
    const $container = $('#popup-memo-container');
    $('#memo-tab-edit-popup').remove();
    
    const charData = getCurrentCharData();
    const tab = charData.tabs[index];
    const $popup = $(`
        <div id="memo-tab-edit-popup" data-index="${index}" style="display: flex !important;">
            <div style="font-weight:bold; font-size:0.85rem; margin-bottom:5px;">탭 설정</div>
            <input type="text" id="edit-tab-name" value="${tab.name}" placeholder="탭 이름">
            <div class="color-picker-row">
                <span>색상:</span>
                <input type="color" id="edit-tab-color" value="${tab.color || '#ffffff'}">
            </div>
            <button id="save-tab-settings" class="menu_button blue_button" style="width:100%; margin-top:5px;">저장</button>
        </div>
    `);

    $container.append($popup);
    
    // 위치 계산
    const rect = e.currentTarget.getBoundingClientRect();
    const containerRect = $container[0].getBoundingClientRect();
    $popup.css({ 
        top: (rect.bottom - containerRect.top + 5) + 'px', 
        left: Math.max(0, rect.left - containerRect.left) + 'px' 
    });

    // 이벤트 바인딩
    $('#save-tab-settings').on('click', (ev) => {
        ev.stopPropagation();
        const newName = $('#edit-tab-name').val().trim();
        if (newName) {
            tab.name = newName;
            tab.color = $('#edit-tab-color').val();
            saveSettingsDebounced();
            renderTabs();
            $popup.remove();
        }
    });

    // 입력창 클릭 시 팝업이 닫히지 않도록 방지
    $popup.on('mousedown', (ev) => ev.stopPropagation());

    // 외부 클릭 시 닫기 (메모장 텍스트 영역 포함)
    setTimeout(() => {
        $(document).one('mousedown.closeTabPopup', (de) => {
            if (!$(de.target).closest('#memo-tab-edit-popup').length) {
                $popup.remove();
            }
        });
    }, 50);
}

function switchTab(index) {
    const charData = getCurrentCharData();
    // 1. 현재 텍스트를 현재 활성화된 탭에 먼저 저장
    const currentContent = $('#popup-memo-textarea').val();
    if (charData.tabs[charData.activeTabIndex]) {
        charData.tabs[charData.activeTabIndex].content = currentContent;
    }

    // 2. 인덱스 변경 및 UI 갱신
    charData.activeTabIndex = index;
    $('#popup-memo-textarea').val(charData.tabs[index].content || '');
    
    renderTabs();
    saveSettingsDebounced();
}

function addTab() {
    const charData = getCurrentCharData();
    charData.tabs.push({ name: `새 탭 ${charData.tabs.length + 1}`, content: '', color: '#ffffff' });
    switchTab(charData.tabs.length - 1);
}

function deleteTab(index) {
    // 기본 메모(0번 인덱스) 삭제 방지
    if (index === 0) {
        showToast('error', '기본 메모 탭은 삭제할 수 없습니다.');
        return;
    }

    const charData = getCurrentCharData();
    if (charData.tabs.length <= 1) return;
    
    if (confirm(`'${charData.tabs[index].name}' 탭을 삭제하시겠습니까?`)) {
        charData.tabs.splice(index, 1);
        
        // 인덱스 보정: 삭제한 탭이 현재 탭이거나 앞쪽이라면 인덱스 조정
        if (charData.activeTabIndex >= index) {
            charData.activeTabIndex = Math.max(0, charData.activeTabIndex - 1);
        }
        
        $('#popup-memo-textarea').val(charData.tabs[charData.activeTabIndex].content || '');
        renderTabs();
        saveSettingsDebounced();
    }
}

function importSettings(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const imported = JSON.parse(e.target.result);
            Object.assign(settings, imported);
            saveSettingsDebounced();
            loadSettingsToUI();
            applySettings();
            showToast('success', '설정을 불러왔습니다.');
        } catch (err) {
            showToast('error', '올바른 파일이 아닙니다.');
        }
    };
    reader.readAsText(file);
}

(async function() {
    try {
        settings = extension_settings.Popupmemo = extension_settings.Popupmemo || DEFAULT_SETTINGS;
        if (Object.keys(settings).length === 0) Object.assign(settings, DEFAULT_SETTINGS);
        
        createMemoPopup();
        $(document).on('mousedown', '#popup-memo-container', (e) => e.stopPropagation());
        updateProfileImages();
        addToWandMenu();

        try {
            const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`);
            $("#extensions_settings2").append(settingsHtml);
            $('#memo_enable_toggle, #memo_storage_mode_toggle, #memo_bg_opacity_input').on('change', onSettingChange);
            $('#memo_show_wand_button').on('change', onSettingChange);
            $('#memo_char_bubble_color_input, #memo_user_bubble_color_input').on('change', onSettingChange); 
            $('.memo-global-char-bubble-input, .memo-global-user-bubble-input, .memo-char-bubble-input, .memo-user-char-bubble-input').on('input', onSettingChange); 
            $('#memo_char_image_override, #memo_user_image_override').on('input', onSettingChange);
            $('#memo_apply_bg_btn').on('click', onSettingChange);
            $('#memo_export_btn').on('click', exportSettings);
            $('#memo_import_btn_trigger').on('click', () => $('#memo_import_file').click());
            $('#memo_import_file').on('change', importSettings);
            loadSettingsToUI();
        } catch (error) { console.error('Settings load fail', error); }

        applySettings();
        eventSource.on(event_types.CHARACTER_SELECTED, onCharacterChange);
        eventSource.on(event_types.USER_AVATAR_UPDATED, updateProfileImages);
        eventSource.on(event_types.SETTINGS_UPDATED, updateProfileImages); // 설정 변경 시 즉시 갱신 추가
        eventSource.on(event_types.CHAT_CHANGED, () => {
            updateProfileImages(); 
            loadSettingsToUI(); 
            applySettings(); 
        });
    } catch (e) { console.error('Init Error', e); }
})();