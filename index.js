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

const extensionName = 'Popupmemo-testing';
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;
const DEFAULT_AVATAR_PATH = '/img/five.png';

let charBubbleTimer;
let charCurrentBubbleIndex = 0;
let userBubbleTimer;
let userCurrentBubbleIndex = 0;

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
            <!-- 상단: 캐릭터 영역 (좌측 Avatar, 우측 Bubble) -->
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

            <!-- 중간: 메모 입력창 -->
            <textarea id="popup-memo-textarea" placeholder="메모를 작성하세요."></textarea>
            
            <!-- 하단: User 영역 (좌측 Bubble, 우측 Avatar) -->
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

    // 드래그 기능 연결 (PC 마우스 전용)
    bindDragFunctionality($memoContainer);

    $memoTextarea.on('mousedown', (e) => e.stopPropagation());

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
    
    // 화면 리사이즈나 회전 시 위치 재조정 (모바일 대응)
    $(window).on('resize', function() {
        if (settings.enabled && window.innerWidth <= 768) {
            applySettings();
        }
    });
    
    console.log('[PopupMemo] DOM Created successfully.');
}

function bindDragFunctionality($element) {
    let isDragging = false;
    let startX, startY;
    let initialLeft, initialTop;
    const container = $element[0];

    if (!container) return;

    function onDragStart(e) {
        // 모바일(화면 폭 768px 이하)이면 드래그 아예 시작 안 함
        if (window.innerWidth <= 768) return;

        if ($(e.target).is('#memo-char-avatar') || $(e.target).is('#memo-user-avatar')) return;
        
        const rect = container.getBoundingClientRect();
        const isResizeHandle = (e.clientX > rect.right - 15 && e.clientY > rect.bottom - 15);

        if ($(e.target).closest('#memo-controls-area').length || $(e.target).is('#popup-memo-textarea') || isResizeHandle) {
            return;
        }

        isDragging = true;
        $element.addClass('grabbing');
        
        startX = e.clientX;
        startY = e.clientY;
        initialLeft = container.offsetLeft;
        initialTop = container.offsetTop;
    }

    function onDragMove(e) {
        if (!isDragging) return;

        let deltaX = e.clientX - startX;
        let deltaY = e.clientY - startY;

        let newLeft = initialLeft + deltaX;
        let newTop = initialTop + deltaY;

        const maxLeft = window.innerWidth - 50;
        const maxTop = window.innerHeight - 50;

        newLeft = Math.max(-100, Math.min(newLeft, maxLeft));
        newTop = Math.max(0, Math.min(newTop, maxTop));

        container.style.left = `${newLeft}px`;
        container.style.top = `${newTop}px`;

        settings.pos.left = newLeft;
        settings.pos.top = newTop;
    }

    function onDragEnd() {
        if (isDragging) {
            isDragging = false;
            $element.removeClass('grabbing');
            saveSettingsDebounced();
        }
    }

    // 마우스 이벤트만 바인딩
    $element.on('mousedown', onDragStart);
    $(document).on('mousemove', onDragMove);
    $(document).on('mouseup', onDragEnd);
}

function getCharacterKey(chid) {
    if (chid === undefined || chid === null || chid === -1) return null;
    const char = characters[chid];
    if (!char) return null;
    // 아바타 파일명을 고유 ID로 사용 (없으면 이름 사용)
    return char.avatar || char.name;
}

function getCurrentCharData() {
    // this_chid(인덱스) 대신 고유 키(파일명)를 가져옴
    const charKey = getCharacterKey(this_chid) || 'no_char_selected'; 
    
    if (!settings.charData) settings.charData = {}; 

    if (!settings.charData[charKey]) {
        settings.charData[charKey] = {
            memoContent: '', 
            charBubbles: ['', '', ''], 
            charImageOverride: '',
            userCharBubbles: ['', '', ''], 
            userImageOverride: '', 
        };
    }
    
    if (!settings.charData[charKey].charBubbles) settings.charData[charKey].charBubbles = ['', '', ''];
    if (!settings.charData[charKey].userCharBubbles) settings.charData[charKey].userCharBubbles = ['', '', ''];
    if (!settings.charData[charKey].userImageOverride) settings.charData[charKey].userImageOverride = ''; 

    return settings.charData[charKey];
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

    // [핵심 로직] 모바일이면 #chat 태그의 크기와 위치를 가져와서 적용
    if (isMobile) {
        const $chat = $('#chat');
        if ($chat.length > 0) {
            // #chat 요소의 정확한 화면상 좌표와 크기 계산
            const rect = $chat[0].getBoundingClientRect();
            
            $memoContainer.css({
                'top': rect.top + 'px',       // #chat의 상단 위치 (탑바 바로 아래)
                'height': rect.height + 'px', // #chat의 높이 (입력창 바로 위까지)
                'left': '50%',                // CSS에서 transform으로 중앙 정렬
                'width': '98%',               // 화면 꽉 차게
                'min-width': 'unset',
                'min-height': 'unset'
            });
        } else {
            // 만약 #chat을 못 찾을 경우 안전 장치 (화면 전체 사용)
            $memoContainer.css({
                'top': '50px',
                'height': 'calc(100vh - 150px)',
                'left': '50%'
            });
        }
    } else {
        $memoContainer.css({
            top: `${settings.pos.top}px`,
            left: `${settings.pos.left}px`,
            width: `${settings.width}px`,
            height: `${settings.height}px`,
            'transform': 'none'
        });
    }

    // [수정됨] 저장 방식에 따라 메모 내용 불러오기
    let savedMemo = '';
    
    if (settings.useCharacterStorage) {
        // ON: 캐릭터 공용 데이터에서 로드
        const charData = getCurrentCharData();
        savedMemo = charData.memoContent || '';
    } else {
        // OFF: 채팅 메타데이터에서 로드
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

    let charPath = DEFAULT_AVATAR_PATH;
    if (charData.charImageOverride && charData.charImageOverride.trim() !== '') { 
        charPath = charData.charImageOverride.trim();
    } else if (currentCharCard && currentCharCard.avatar) {
        charPath = `/thumbnail?type=avatar&file=${currentCharCard.avatar}`;
    }
    
    let personaPath = DEFAULT_AVATAR_PATH;
    if (charData.userImageOverride && charData.userImageOverride.trim() !== '') { 
        personaPath = charData.userImageOverride.trim();
    } else {
        const personaFileName = user_avatar;
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

    if (timerRef) {
        clearInterval(timerRef);
    }
    
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
            $bubbleContainer.removeClass('bubble-flicker-out');
            $bubbleContainer.addClass('bubble-flicker-in');
            
            setTimeout(() => {
                $bubbleContainer.removeClass('bubble-flicker-in');
            }, 500); 

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

// Debounce 함수 정의
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
    // 채팅이 없거나 로드되지 않았으면 빈 문자열 반환
    if (!context.chat || context.chat.length === 0) return '';
    
    // 첫 번째 메시지의 extra 데이터 확인
    const firstMes = context.chat[0];
    if (!firstMes.extra) firstMes.extra = {};
    
    return firstMes.extra.popupmemo_content || '';
}

const saveMemoContentDebounced = debounce(async () => {
    const content = $('#popup-memo-textarea').val();
    
    // 모드 1: 캐릭터 공용 저장소 사용 (ON)
    if (settings.useCharacterStorage) {
        // 캐릭터가 선택되지 않았거나 키를 생성할 수 없으면 중단
        if (this_chid === undefined || this_chid === -1) return;
        
        const charData = getCurrentCharData(); // 수정된 함수가 고유 키를 사용하여 데이터를 가져옴
        charData.memoContent = content;
        
        saveSettingsDebounced(); // settings.json에 저장
        renderCharMemoList();    // 설정창 목록 갱신
    } 
    // 모드 2: 채팅별 개별 저장 (OFF)
    else {
        const context = getContext();
        if (context.chat && context.chat.length > 0) {
            const firstMes = context.chat[0];
            if (!firstMes.extra) firstMes.extra = {};

            if (firstMes.extra.popupmemo_content !== content) {
                firstMes.extra.popupmemo_content = content;
                await saveChat(); // 채팅 파일에 저장
            }
        }
    }
}, 500); // 0.5초 디바운스

function toggleIgnoreClick() {
    settings.ignoreClick = !settings.ignoreClick;
    applySettings(); 
    saveSettingsDebounced();
}

function renderCharMemoList() {
    const $container = $('#memo_char_list_container');
    $container.empty();

    if (!settings.charData) return;

    // 데이터가 있는 항목만 필터링 (메모가 있거나 오버라이드 설정이 있는 경우)
    const charEntries = Object.entries(settings.charData)
        .filter(([charKey, data]) => {
            return charKey !== 'no_char_selected' && (
                (data.memoContent && data.memoContent.trim() !== '') || 
                (data.charImageOverride || data.userImageOverride) ||
                (data.charBubbles && data.charBubbles.some(b => b))
            );
        });

    if (charEntries.length === 0) {
        $container.append('<div style="text-align: center; color: #999; padding: 20px;">저장된 캐릭터 데이터가 없습니다.</div>');
        return;
    }

    charEntries.forEach(([charKey, data]) => {
        // charKey는 이제 파일명이므로, characters 배열에서 avatar가 일치하는 캐릭터를 찾아야 함
        const charCard = characters.find(c => c.avatar === charKey || c.name === charKey);
        // 캐릭터가 존재하면 이름을, 없으면 파일명을 표시
        const charName = charCard ? charCard.name : `(미설치/삭제됨: ${charKey})`;
        
        let memoPreview = '(메모 없음)';
        if (data.memoContent && data.memoContent.trim() !== '') {
            const firstLine = data.memoContent.trim().split('\n')[0];
            memoPreview = firstLine.substring(0, 50) + (firstLine.length > 50 ? '...' : '');
        } else {
            memoPreview = '<span style="color:#aaa; font-style:italic;">설정 데이터만 존재</span>';
        }

        const listItem = `
            <div class="memo-list-item" data-char-key="${charKey}" style="border-left: 4px solid #6b82d8;">
                <div class="memo-list-item-content">
                    <div style="font-weight:bold; color:#555;">${charName}</div>
                    <div style="font-size:0.85em; color:#777; margin-top:2px;">${memoPreview}</div>
                </div>
                <div class="memo-btn-group">
                    <button class="memo-copy-btn" data-char-key="${charKey}" title="메모 복사">
                        <i class="fa-solid fa-copy"></i>
                    </button>
                    <button class="memo-migrate-btn" data-char-key="${charKey}" title="현재 채팅으로 가져오기">
                        <i class="fa-solid fa-file-import"></i>
                    </button>
                    <button class="memo-delete-btn" data-char-key="${charKey}" title="데이터 완전 삭제">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
            </div>
        `;
        $container.append(listItem);
    });
    
    // 이벤트 바인딩 (data 속성 이름이 charId -> charKey로 변경됨에 유의)
    $('.memo-copy-btn').off('click').on('click', copyCharMemo);
    $('.memo-migrate-btn').off('click').on('click', migrateCharMemo);
    $('.memo-delete-btn').off('click').on('click', deleteCharMemo);
}

function copyCharMemo(e) {
    const charKey = $(e.currentTarget).data('charKey');
    const data = settings.charData[charKey];
    
    if (data && data.memoContent) {
        if (navigator.clipboard) {
            navigator.clipboard.writeText(data.memoContent).then(() => {
                showToast('success', '메모 내용이 클립보드에 복사되었습니다.');
            }).catch(err => {
                console.error('클립보드 복사 실패:', err);
                showToast('error', '복사에 실패했습니다. 콘솔을 확인해주세요.');
            });
        } else {
            showToast('warning', '클립보드 API를 사용할 수 없는 환경입니다.');
        }
    }
}

async function migrateCharMemo(e) {
    const oldCharKey = $(e.currentTarget).data('charKey');
    
    // UI에서 보여지는 이름 가져오기 (안전 처리)
    const $itemDiv = $(e.currentTarget).closest('.memo-list-item');
    const displayName = $itemDiv.find('.memo-list-item-content > div:first-child').text() || '대상 캐릭터';

    // 1. 가져올 데이터 원본 확인
    const sourceData = settings.charData[oldCharKey];
    const contentToMigrate = sourceData ? sourceData.memoContent : '';

    if (!contentToMigrate) {
        showToast('error', '이동할 데이터가 비어있습니다.');
        return;
    }

    // 2. 사용자 확인
    if (!confirm(`'${displayName}'의 데이터를 현재 화면으로 가져오시겠습니까?\n\n주의: 현재 입력창의 내용은 덮어씌워집니다.`)) {
        return;
    }

    // 3. [핵심 수정] 현재 활성화된 저장 모드에 따라 목적지 결정
    if (settings.useCharacterStorage) {
        // [CASE A] 글로벌 저장소 모드 사용 중 (Settings.json에 저장해야 함)
        // 현재 캐릭터의 올바른 키(파일명)를 가져옴
        const currentCharKey = getCharacterKey(this_chid);
        
        if (!currentCharKey) {
            showToast('error', '현재 선택된 캐릭터를 식별할 수 없습니다.');
            return;
        }

        // 데이터 구조가 없으면 생성 (getCurrentCharData 로직 활용 가능하나 명시적으로 처리)
        if (!settings.charData[currentCharKey]) {
            getCurrentCharData(); 
        }

        // 새로운 키 위치에 내용 주입
        settings.charData[currentCharKey].memoContent = contentToMigrate;
        
        // *중요*: 글로벌 모드에서는 saveChat이 아니라 saveSettings가 필요함
        // (아래 공통 로직에서 saveSettingsDebounced가 호출됨)

    } else {
        // [CASE B] 채팅별 개별 저장 모드 사용 중 (Chat 파일에 저장해야 함)
        const context = getContext();
        if (!context.chat || context.chat.length === 0) {
            showToast('warning', '메모를 저장할 활성화된 채팅이 없습니다.');
            return;
        }

        if (!context.chat[0].extra) context.chat[0].extra = {};
        context.chat[0].extra.popupmemo_content = contentToMigrate;

        // 채팅 파일 저장
        await saveChat();
    }

    // 4. UI 즉시 갱신 (텍스트박스에 바로 보여주기)
    $('#popup-memo-textarea').val(contentToMigrate);

    // 5. 기존(과거) 데이터 삭제
    delete settings.charData[oldCharKey];

    // 6. 설정 저장 (삭제된 내용 반영 및 글로벌 모드일 경우 변경된 내용 저장)
    saveSettingsDebounced();

    // 7. 리스트 UI 갱신 (이동된 항목 사라짐)
    renderCharMemoList();
    
    showToast('success', `데이터가 성공적으로 이동되었습니다.`);
}

function deleteCharMemo(e) {
    const charKeyToDelete = $(e.currentTarget).data('charKey');
    const charName = $(e.currentTarget).closest('.memo-list-item').find('b').text(); // 주의: 위쪽 render에서 b태그를 안쓰고 div font-weight:bold를 썼으므로 선택자 조정 필요할 수 있음, 아래 수정됨.
    
    // 안전하게 이름 가져오기
    const displayName = $(e.currentTarget).closest('.memo-list-item').find('.memo-list-item-content > div:first-child').text() || '캐릭터';

    if (confirm(`정말로 '${displayName}' 캐릭터의 메모와 모든 설정을 삭제하시겠습니까?`)) {
        delete settings.charData[charKeyToDelete];
        
        // 만약 현재 보고 있는 캐릭터의 데이터를 삭제했다면 입력창도 비워줌
        const currentCharKey = getCharacterKey(this_chid);
        if (currentCharKey === charKeyToDelete) {
            $('#popup-memo-textarea').val('');
        }
        
        saveSettingsDebounced();
        renderCharMemoList();
        applySettings();
    }
}

function onSettingChange() {
    const charData = getCurrentCharData();
    
    settings.enabled = $('#memo_enable_toggle').prop('checked');
    
    // [추가됨] 저장 방식 토글 값 저장
    const prevMode = settings.useCharacterStorage;
    settings.useCharacterStorage = $('#memo_storage_mode_toggle').prop('checked');
    
    // 모드가 바뀌었으면 즉시 메모 내용을 다시 불러와서 교체해줌 (중요!)
    if (prevMode !== settings.useCharacterStorage) {
        applySettings();
    }

    settings.showWandButton = $('#memo_show_wand_button').prop('checked');

    settings.bgOpacity = parseFloat($('#memo_bg_opacity_input').val()) || 0.7;
    settings.bgImage = $('#memo_bg_image_input').val().trim();
    
    settings.charBubbleColor = $('#memo_char_bubble_color_input').val().trim() || '#FFFFFF';
    settings.userBubbleColor = $('#memo_user_bubble_color_input').val().trim() || '#F0F0F0';
    
    charData.userImageOverride = $('#memo_user_image_override').val().trim();

    settings.charBubbles = $('.memo-global-char-bubble-input').map(function() {
        return $(this).val();
    }).get();
    
    settings.userBubbles = $('.memo-global-user-bubble-input').map(function() {
        return $(this).val();
    }).get();
    
    charData.charBubbles = $('.memo-char-bubble-input').map(function() {
        return $(this).val();
    }).get();

    charData.userCharBubbles = $('.memo-user-char-bubble-input').map(function() {
        return $(this).val();
    }).get();

    charData.charImageOverride = $('#memo_char_image_override').val().trim();
    
    updateWandMenuVisibility();

    applySettings();
    saveSettingsDebounced();
}

function loadSettingsToUI() {
    const charData = getCurrentCharData();
    // this_chid가 있고 실제 characters 객체에 존재하는지 확인
    const isCharSelected = this_chid && characters[this_chid];
    const charName = isCharSelected ? characters[this_chid].name : '캐릭터 미선택';

    // 토글 스위치 상태 반영
    $('#memo_enable_toggle').prop('checked', settings.enabled);
    $('#memo_storage_mode_toggle').prop('checked', settings.useCharacterStorage);
    $('#memo_show_wand_button').prop('checked', settings.showWandButton);

    // 값 입력 필드 반영
    $('#memo_bg_opacity_input').val(settings.bgOpacity);
    $('#memo_bg_image_input').val(settings.bgImage);
    
    $('#memo_char_bubble_color_input').val(settings.charBubbleColor);
    $('#memo_user_bubble_color_input').val(settings.userBubbleColor);
    
    $('#memo_char_bubble_color_input_text').val(settings.charBubbleColor);
    $('#memo_user_bubble_color_input_text').val(settings.userBubbleColor);
    
    // UI상 캐릭터 이름 업데이트 (말풍선 탭)
    $('#memo_current_char_name').text(charName);

    // [수정됨] 캐릭터 선택 여부에 따라 오버라이드 UI 토글
    if (isCharSelected) {
        $('#memo_override_container').show();
        $('#memo_no_char_message').hide();
        
        // 데이터가 있을 때만 값 채우기
        $('#memo_user_image_override').val(charData.userImageOverride);
        $('#memo_char_image_override').val(charData.charImageOverride);

        if (!charData.charBubbles) charData.charBubbles = ['', '', ''];
        charData.charBubbles.forEach((bubble, index) => {
            $(`#memo_char_bubble_${index + 1}`).val(bubble);
        });
        
        if (!charData.userCharBubbles) charData.userCharBubbles = ['', '', ''];
        charData.userCharBubbles.forEach((bubble, index) => {
            $(`#memo_user_char_bubble_${index + 1}`).val(bubble);
        });

    } else {
        $('#memo_override_container').hide();
        $('#memo_no_char_message').show();
    }

    // 전역 말풍선 (항상 표시)
    settings.charBubbles.forEach((bubble, index) => {
        $(`#memo_global_char_bubble_${index + 1}`).val(bubble);
    });
    settings.userBubbles.forEach((bubble, index) => {
        $(`#memo_global_user_bubble_${index + 1}`).val(bubble);
    });
    
    // 데이터 관리 리스트 렌더링
    renderCharMemoList();
}

function onCharacterChange() {
    loadSettingsToUI(); 
    applySettings(); 
}
function exportSettings() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(settings, null, 2));
    const downloadAnchorNode = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `popupmemo_backup_${date}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
    
    showToast('success', 'PopupMemo 설정이 내보내졌습니다.');
}

function importSettings(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const importedSettings = JSON.parse(e.target.result);
            
            // 유효성 검사 (간단하게)
            if (typeof importedSettings !== 'object') throw new Error('Invalid JSON');

            // 기존 설정 덮어쓰기
            Object.assign(settings, importedSettings);
            saveSettingsDebounced();
            
            // UI 갱신
            loadSettingsToUI();
            applySettings();
            
            showToast('success', '설정을 성공적으로 불러왔습니다.');
        } catch (err) {
            console.error('[PopupMemo] Import failed:', err);
            showToast('error', '설정 불러오기 실패: 올바른 JSON 파일이 아닙니다.');
        }
        // input 초기화 (같은 파일 다시 로드 가능하게)
        event.target.value = '';
    };
    reader.readAsText(file);
}
(async function() {
    console.log('[PopupMemo] Extension loading...');

    try {
        settings = extension_settings.Popupmemo = extension_settings.Popupmemo || DEFAULT_SETTINGS;
        if (Object.keys(settings).length === 0) {
            settings = Object.assign(extension_settings.Popupmemo, DEFAULT_SETTINGS);
        }
        
        if (!settings.charBubbles) settings.charBubbles = DEFAULT_SETTINGS.charBubbles;
        if (!settings.userBubbles) settings.userBubbles = DEFAULT_SETTINGS.userBubbles;
        if (!settings.charBubbleColor) settings.charBubbleColor = DEFAULT_SETTINGS.charBubbleColor;
        if (!settings.userBubbleColor) settings.userBubbleColor = DEFAULT_SETTINGS.userBubbleColor;
        if (!settings.pos) settings.pos = { top: 50, left: 50 }; 
        if (settings.showWandButton === undefined) settings.showWandButton = true;

        createMemoPopup();
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

            $('#memo_apply_bg_btn').on('click', () => {
                onSettingChange();
                $('#memo_bg_image_input').blur();
            });

            $('#memo_reset_bubbles_btn').on('click', () => {
                if (confirm('모든 글로벌 말풍선 대사 내용을 초기화하시겠습니까? (캐릭터별 설정은 유지됩니다)')) {
                    $('.memo-global-char-bubble-input').val('');
                    $('.memo-global-user-bubble-input').val(''); 
                    onSettingChange();
                }
            });
            $('#memo_export_btn').on('click', exportSettings);
            
            $('#memo_import_btn_trigger').on('click', () => {
                $('#memo_import_file').click();
            });
            
            $('#memo_import_file').on('change', importSettings);
            loadSettingsToUI();

        } catch (error) {
            console.error(`[${extensionName}] Failed to load settings.html:`, error);
        }

        applySettings();

        eventSource.on(event_types.CHARACTER_SELECTED, onCharacterChange);
        eventSource.on(event_types.USER_AVATAR_UPDATED, updateProfileImages);
        
        eventSource.on(event_types.CHAT_CHANGED, () => {
            updateProfileImages(); 
            loadSettingsToUI();
            applySettings(); 
        });
        
        eventSource.on(event_types.SETTINGS_UPDATED, updateProfileImages);
        
        console.log('[PopupMemo] Extension loaded successfully.');

    } catch (e) {
        console.error('[PopupMemo] Critical Error during initialization:', e);
    }
})();