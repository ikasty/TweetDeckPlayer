const {remote, clipboard, ipcRenderer, shell} = require('electron');
// Guard against missing remote function properties
// https://github.com/electron/electron/pull/7209
try {
  const {Menu, MenuItem, dialog} = remote;
} catch (e) {
  console.warn('remote error : ' + e);
};
const path = require('path');
const os = require('os');
const fs = require('fs');
const twitter = require('twitter-text');
const twemoji = require('twemoji');

const Config = require('./config');
const VERSION = require('./version').message;
const Util = require('./util');

const PlayerMonkey = require('./preload_scripts/playermonkey');
const WordFilter = require('./preload_scripts/wordfilter');
const Unlinkis = require('./preload_scripts/unlinkis');
const CBPaste = require('./preload_scripts/clipboard-paste');
const TwtLib = require('./preload_scripts/twtlib');
const AutoSaveFav = require('./preload_scripts/autosave-favorites');
const EmojiPad = require('./preload_scripts/emojipad');
const QuoteWithoutNotification = require('./preload_scripts/quote-without-notification');
const GifAutoplay = require('./preload_scripts/gif-autoplay');
const ImageViewer = require('./preload_scripts/image-viewer');
const SwitchAccount = require('./preload_scripts/switch-account');
const WikiLinkFixer = require('./preload_scripts/wikilinkfix');
const CounterClear = require('./preload_scripts/counterclear');
const UserNotes = require('./preload_scripts/user-note.js');

// 설정 파일 읽기
var config = Config.load();

var keyState = {
  shift: false,
  alt: false,
  ctrl: false,
};

var loadTimeStamp, configReloadCycle;
var autoReload_alermed = 0;

var updateSound_backup;

// n시간 후 강제 리로드
var autoReload = () => {

  config = Config.load();
  if (!config.applyAutoReload || config.autoReloadCycle !== configReloadCycle) {
    loadTimeStamp = new Date().getTime();
    configReloadCycle = config.autoReloadCycle * 1;
    autoReload_alermed = 0;
  }

  var checkTime = milliseconds => {
    return (loadTimeStamp + 60000 * 60 * configReloadCycle + milliseconds <= new Date().getTime());
  };

  switch (autoReload_alermed) {
    case 0:
      if (window.toastMessage && checkTime(0)) {
        window.toastMessage('Automatically reload in one minute');
        loadTimeStamp += 60000;
        autoReload_alermed++;
        break;
      }
      
      setTimeout(autoReload, 60000);
      return;

    case 1:
      if (checkTime(50000)) {
        window.toastMessage('Automatically reload in a few seconds');
        autoReload_alermed++;
      }
      break;

    case 2:
      if (checkTime(60000)) {
        remote.getCurrentWindow().reload();
      }
      break;
  }
  setTimeout(autoReload, 5000);
};
autoReload();

const loadBlackBird = (callback) => {
  var oReq = new XMLHttpRequest();
  oReq.addEventListener("load", function () {
    const res = JSON.parse(this.responseText);
    if (res.client && res.client.settings && res.client.settings) {
      const tdp_settings = res.client.settings.settings.TDPSettings || {};
      callback(tdp_settings);
    }
  });
  oReq.addEventListener('error', function () {
    callback({error: true});
  })
  oReq.open('GET', 'https://api.twitter.com/1.1/tweetdeck/clients/blackbird/all');
  oReq.withCredentials = true;
  oReq.setRequestHeader('Content-Type', 'application/json');
  oReq.setRequestHeader('Authorization', 'Bearer ' + TD.config.bearer_token);
  oReq.setRequestHeader('x-csrf-token', TD.util.getCsrfTokenHeader());
  //oReq.setRequestHeader('User-Agent', TD.util.getTweetDeckUserAgentString());
  oReq.send();
}

const saveBlackBird = (callback, params) => {
  var oReq = new XMLHttpRequest();
  oReq.addEventListener("load", function () {
    const res = JSON.parse(this.responseText);
    if (res.client && res.client.settings && res.client.settings) {
      const tdp_settings = res.client.settings.settings.TDPSettings || {};
      callback(tdp_settings);
    }
  });
  oReq.addEventListener('error', function () {
    callback({error: true});
  })
  oReq.open('POST', 'https://api.twitter.com/1.1/tweetdeck/clients/blackbird');
  oReq.withCredentials = true;
  oReq.setRequestHeader('Content-Type', 'application/json');
  oReq.setRequestHeader('Authorization', 'Bearer ' + TD.config.bearer_token);
  oReq.setRequestHeader('x-csrf-token', TD.util.getCsrfTokenHeader());
  //oReq.setRequestHeader('User-Agent', TD.util.getTweetDeckUserAgentString());
  oReq.send(JSON.stringify(params));
}

ipcRenderer.on('cloud-load-config', (event, uuid) => {
  loadBlackBird((TDPSettings) => {
    if (TDPSettings.saved_timestamp) {
      event.sender.send(uuid, JSON.stringify(TDPSettings));
      return;
    }
    event.sender.send(uuid, false);
    return;
  });
});
/*
ipcRenderer.on('cloud-save-config', (event, uuid, title) => {
  const config = Config.load();
  config.saved_timestamp = new Date();
  config.saved_title = title || '';
  if (config.bounds)
    delete config.bounds;
  let blackbird_acc = TD.storage.clientController.getAll()[0];
  blackbird_acc.settings.settings.TDPSettings = config;
  saveBlackBird(() => {
    loadBlackBird((TDPSettings) => {
      if (TDPSettings.saved_timestamp) {
        event.sender.send(uuid, JSON.stringify(TDPSettings));
        return;
      }
      event.sender.send(uuid, false);
      return;
    });
  }, blackbird_acc);
});
*/

ipcRenderer.on('cloud-save-config', (event, uuid, title) => {
  const config = Config.load();
  config.saved_timestamp = new Date();
  config.saved_title = title || '';
  if (config.bounds)
    delete config.bounds;
  if (TD && TD.settings) {
    TD.settings.set('TDPSettings', config);
  }
  TD.storage.clientController.getAll();
  event.sender.send(uuid, true);
});

ipcRenderer.on('cloud-remove-config', (event, uuid, title) => {
  const config = Config.load();
  config.saved_timestamp = new Date();
  config.saved_title = title || '';
  if (config.bounds)
    delete config.bounds;
  if (TD && TD.settings) {
    TD.settings.set('TDPSettings', undefined);
  }
  TD.storage.clientController.getAll();
  event.sender.send(uuid, true);
});

ipcRenderer.on('apply-config', event => {
  var style = '';
  try {
    var { detectFont, supportedFonts } = require('detect-font');
    config = Config.load();
    window.config = config;

    if (Config.data.customFonts) {
      var node = document.createElement('div');
      var fonts = config.customFonts.split(',').map(x => x.trim()).filter(x => x !== '').map(x => `'${x}'`);
      node.id = 'fontDetect';
      node.style = `font-family: ${fonts.join(',')} !important`;
      document.body.insertBefore(node, document.body.firstChild);

      var sf = supportedFonts(node).map(x => `'${x.replace('"', '').trim()}'`);
      var notSupported = (() => {
        var tmpSet = new Set(sf);
        return fonts.filter(x => !tmpSet.has(x));
      })();

      if (notSupported.length !== 0) {
        console.warn(`Not Supported Font(s): ${notSupported.join(', ')}`);
      }
      style = `font-family: ${sf.join(',')} !important;`;

      node.remove();
    } else {
      style = '';
    }

    // Mention/Hashtag/URL Color
    document.body.querySelector('.js-app.application').style = `--mention-color: ${Config.data.twColorMention};--hashtag-color: ${Config.data.twColorHashtag};--url-color: ${Config.data.twColorURL}`;

    const cl = document.body.classList;
    if (config.useStarForFavorite) {
      cl.remove('hearty');
      cl.add('starry');
    } else {
      cl.remove('starry');
      cl.add('hearty');
    }
    cl.toggle('tdp-square-profile', config.useSquareProfileImage);
    if (config.applyCustomizeSlider && !cl.contains('customize-columns')) {
      cl.add('customize-columns');
    } else if (!config.applyCustomizeSlider && cl.contains('customize-columns')) {
      cl.remove('customize-columns');
    }

    style += `--column-size: ${config.customizeColumnSize}px;`;

    if (config.showColorLabels) {
      cl.add('tdp-color-labels');
    } else {
      cl.remove('tdp-color-labels');
    }

    document.body.style = style;

    let fontsize = config.customFontSize;
    if (/^\d+$/.test(fontsize)) {
      fontsize = fontsize.toString() + 'px';
    }

    fontsize = fontsize.replace(/'/g, String.raw`\'`);
    fontsize = fontsize.replace(/\\/g, '');
    var tdp_customFontStyle = document.getElementById('TDP_customFontStyle');
    if (tdp_customFontStyle === null) {
      tdp_customFontStyle = document.createElement('style');
      tdp_customFontStyle.id = 'TDP_customFontStyle';
      document.body.appendChild(tdp_customFontStyle)
    }

    tdp_customFontStyle.innerText = `
      html, body, .os-windows, .is-inverted-dark,
      .tweet-text,
      .column {
        font-size: ${fontsize} !important;
        line-height: initial;
      }
    `;

    // Notification Alarm sound
    if (updateSound_backup === undefined) {
      updateSound_backup = document.getElementById("update-sound").innerHTML;
    }

    if (config.applyNotiAlarmSound) {
      var base64_encode = file => {
        var bitmap = fs.readFileSync(file);
        return new Buffer(bitmap).toString('base64');
      };

      var base64_decode = (base64str, file) => {
        // create buffer object from base64 encoded string, it is important to tell the constructor that the string is base64 encoded
        var bitmap = new Buffer(base64str, 'base64');
        // write buffer to file
        fs.writeFileSync(file, bitmap);
        console.log('******** File created from base64 encoded string ********');
      };

      var convertDataURIToBinary = dataURI => {
        var BASE64_MARKER = ';base64,';
        var base64Index = dataURI.indexOf(BASE64_MARKER) + BASE64_MARKER.length;
        var base64 = dataURI.substring(base64Index);
        var raw = window.atob(base64);
        var rawLength = raw.length;
        var array = new Uint8Array(new ArrayBuffer(rawLength));

        for (var i = 0; i < rawLength; i++) {
          array[i] = raw.charCodeAt(i);
        }
        return array;
      };

      var ext = config.notiAlarmSoundExt;
      var data = `data:audio/${ext};base64,${base64_encode(path.join(Util.getUserDataPath(), 'alarmfile'))}`;

      var binary = convertDataURIToBinary(data);
      var blob = new Blob([binary], {type : `audio/${ext}`});
      var blobUrl = URL.createObjectURL(blob);

      document.getElementById("update-sound").innerHTML = `<source src="${blobUrl}">`;
      document.getElementById("update-sound").pause();
      document.getElementById("update-sound").load();
    } else {
      document.getElementById("update-sound").innerHTML = updateSound_backup;
      document.getElementById("update-sound").pause();
      document.getElementById("update-sound").load();
    }
  } catch (e) {
    console.warn(e);
  }
});

// 우클릭시 임시 저장하는 이미지 주소와 링크 주소를 담는 변수
var Addr = {
  img: '',
  link: '',
  id: '',
  text: '',
};

// 포인터 이벤트
ipcRenderer.on('no-pointer', (event, opt) => {
  if (opt && !document.body.classList.contains('no-pointer')) {
    document.body.classList.add('no-pointer');
  } else if (!opt && document.body.classList.contains('no-pointer')) {
    document.body.classList.remove('no-pointer');
  }
});

// 메인 스레드에서 렌더러로 요청하는 커맨드
ipcRenderer.on('command', (event, cmd) => {
  var href;
  switch (cmd) {
    case 'cut':
      document.execCommand('cut');
      break;
    case 'copy':
      document.execCommand('copy');
      break;
    case 'paste':
      document.execCommand('paste');
      break;
    case 'delete':
      document.execCommand('delete');
      break;
    case 'selectall':
      document.execCommand('selectall');
      break;
    case 'copyimage':
      window.toastMessage('Image downloading..');
      const nativeImage = require('electron').nativeImage;
      var request = require('request').defaults({ encoding: null });
      request.get(Addr.img, function (error, response, body) {
        if (!error && response.statusCode === 200) {
          clipboard.writeImage(nativeImage.createFromBuffer(body));
          window.toastMessage('Image copied to clipboard');
        }
      });
      break;
    case 'copyimageurl':
      href = Util.getOrigPath(Addr.img);
      clipboard.writeText(href);
      break;
    case 'openimage':
      href = Util.getOrigPath(Addr.img);
      window.open(href);
      break;
    case 'openimagepopup':
      href = Util.getOrigPath(Addr.img);
      window.open(href, 'popup');
      break;
    case 'googleimage':
      href = 'https://www.google.com/searchbyimage?image_url=' +
                encodeURI(Util.getOrigPath(Addr.img));
      window.open(href);
      break;
    case 'openlink':
      href = Util.getOrigPath(Addr.link);
      window.open(href);
      break;
    case 'openlinkpopup':
      href = Util.getOrigPath(Addr.link);
      window.open(href, 'popup');
      break;
    case 'copylink':
      href = Util.getOrigPath(Addr.link);
      clipboard.writeText(href);
      break;
    case 'reload':
      remote.getCurrentWindow().reload();
      break;
    case 'quotewithoutnotification':
      QuoteWithoutNotification(ipcRenderer, Addr.id);
      break;
    case 'copy-tweet': {
      const text = Addr.text;
      clipboard.writeText(text);
      window.toastMessage(window.TD.i('Copied text "{{text}}" ! ', { text }));
    } break;
    case 'copy-tweet-with-author': {
      const el = document.querySelector(`article[data-tweet-id="${Addr.id}"]`);
      const userid = el.querySelector('.username');
      let text = Addr.text;
      if (userid) {
        text += ` (by ${userid.textContent})`;
      }
      clipboard.writeText(text);
      window.toastMessage(window.TD.i('Copied text "{{text}}" ! ', { text }));
    } break;
    case 'open-google-translator': {
      ipcRenderer.send('open-google-translator', {
        text: Addr.text,
      });
    } break;
  }
});

// 컨텍스트 메뉴 이벤트 리스너
window.addEventListener('contextmenu', e => {
  var target;

  // 기존 메뉴 이벤트를 무시
  e.preventDefault();

  // 현재 활성화된 element
  var el = document.activeElement;

  // 현재 마우스가 가리키고 있는 elements
  var hover = document.querySelectorAll(':hover');

  // 선택 영역이 있는지 여부
  var is_range = document.getSelection().type === 'Range';

  // input=text 또는 textarea를 가리킴
  if (is_range) {
    target = 'text_sel';
  } else if (el
    && (el.tagName.toLowerCase() === 'input' && el.type === 'text')
    || (el.tagName.toLowerCase() === 'textarea')) {
    target = (is_range ? 'input_sel' : 'text');
  } else if (document.querySelector('.js-app-settings:hover')) {
    // 설정 버튼
    target = 'setting';
  } else if (document.querySelector('img:hover')) {
    // 이미지
    Addr.img = document.querySelector('img:hover').src;

    // 링크가 포함되어 있는 경우
    if (document.querySelector('a:hover')) {
      Addr.link = document.querySelector('a:hover').href;
      target = 'linkandimage';
    } else {
      target = 'image';
    }
  } else if (document.querySelector('.js-media-image-link:hover')) {
    // 미디어 이미지 박스 (트윗 내의 이미지 박스)
    Addr.img = document.querySelector('.js-media-image-link:hover').style.backgroundImage.slice(5, -2);
    target = 'image';
  } else if (document.querySelector('a:hover') && document.querySelector('a:hover').href) {
    // 링크
    Addr.link = document.querySelector('a:hover').href;
    target = 'link';
  } else if (document.querySelector('article.stream-item:hover')) {
    // 트윗
    target = 'tweet';
    /* 참고:
    * data-tweet-id속성이 없거나 트윗 내용(.js-tweet-text)이 없는 경우가 있다.
    * - 가리킨 트윗이 Activity column의 팔로워/리스트추가일 경우
    * - DM인 경우
    */
    const hoveredTweet = document.querySelector('article.stream-item:hover');
    const tweetText = hoveredTweet.querySelector('.js-tweet-text');
    const tweetId = hoveredTweet.getAttribute('data-tweet-id');
    function getTextOrEmoji (node) {
      if (node.nodeType === HTMLElement.TEXT_NODE) {
        return node.textContent;
      } else if (node.nodeType === HTMLElement.ELEMENT_NODE && node.classList.contains('emoji')) {
        return node.getAttribute('alt');
      } else {
        return '';
      }
    }
    const textWithEmoji = Array
      .from(tweetText ? tweetText.childNodes : [])
      .map(getTextOrEmoji)
      .join('');
    Addr.text = textWithEmoji;
    Addr.id = tweetId || '';
  } else {
    // 기본 컨텍스트
    target = 'main';
  }

    // 컨텍스트 메뉴를 띄우라고 메인 스레드에 요청
  ipcRenderer.send('context-menu', target, is_range, Addr);
}, false);

document.addEventListener('DOMContentLoaded', WordFilter);
document.addEventListener('DOMContentLoaded', CBPaste);
document.addEventListener('DOMContentLoaded', TwtLib);
document.addEventListener('DOMContentLoaded', GifAutoplay);
document.addEventListener('DOMContentLoaded', ImageViewer);
document.addEventListener('DOMContentLoaded', SwitchAccount);
document.addEventListener('DOMContentLoaded', WikiLinkFixer);
document.addEventListener('DOMContentLoaded', CounterClear);
document.addEventListener('DOMContentLoaded', UserNotes);


if (config.enableUnlinkis) {
  document.addEventListener('DOMContentLoaded', Unlinkis);
}

// 트윗에 첨부된 이미지를 드래그해서 저장할 수 있도록 함
document.addEventListener('dragstart', evt => {
  var imageSrc = '';
  var imageOrgSrc = '';

  if (evt.srcElement.classList.contains('js-media-image-link')) {
    // 트윗 미디어 이미지
    imageSrc = evt.srcElement.style.backgroundImage.slice(5, -2);
  } else if (typeof evt.srcElement.currentSrc !== 'undefined' && evt.srcElement.currentSrc !== '') {
    // 일반 이미지
    imageSrc = evt.srcElement.currentSrc;
  }

  // 이미지인 경우
  if (imageSrc) {
    imageOrgSrc = imageSrc;
    var image = Util.getOrigPath(imageSrc);
    var ext = image.substr(image.lastIndexOf('.') + 1);
    var filename = image.substr(image.lastIndexOf('/') + 1);
    if (filename.lastIndexOf(':') !== -1) {
      ext = ext.substr(0, ext.lastIndexOf(':'));
      filename = filename.substr(0, filename.lastIndexOf(':'));
    }
    var detail = `image/${ext}:${filename}:${image}`;
    evt.dataTransfer.setData('DownloadURL', detail);
  }
}, false);

document.addEventListener('DOMContentLoaded', () => {
  const TD = window.TD;
  const $ = window.$;

  window.toastMessage = message => {
    window.webpackJsonp([0], [(a, b, c) => {
      const toaster = c(7);
      if (typeof toaster.showNotification === 'function') {
        toaster.showNotification({ message });
      }
    }]);
  };

  window.toastErrorMessage = message => {
    window.webpackJsonp([0], [(a, b, c) => {
      const toaster = c(7);
      if (typeof toaster.showErrorNotification === 'function') {
        toaster.showErrorNotification({ message });
      }
    }]);
  };

  function patchContentEditable () {
    $('[contenteditable="true"]').css({
      opacity: 0,
      pointerEvents: 'none',
    });
  }
  if (window.TD_mustaches) {
    // version
    window.TD_mustaches['version.mustache'] = `${VERSION} (TweetDeck {{version}}{{#buildIDShort}}-{{buildIDShort}}{{/buildIDShort}})`;

    // set min_width to modal context
    window.TD_mustaches['modal/modal_context.mustache'] = window.TD_mustaches['modal/modal_context.mustache'].replace('<div class="js-modal-context', '<div style="min-width: 560px;" class="js-modal-context');
    window.TD_mustaches['app_container.mustache'] = window.TD_mustaches['app_container.mustache'].replace('<div id="open-modal', '<div style="min-width: 650px;" id="open-modal');

    // create emojipad entry point
    window.TD_mustaches['compose/docked_compose.mustache'] = window.TD_mustaches['compose/docked_compose.mustache'].replace('<div class="js-send-button-container', '<div class="btn btn-on-blue padding-v--9 emojipad--entry-point"><img class="emoji" src="https://twemoji.maxcdn.com/2/72x72/1f600.png" style="pointer-events:none;"></div> <div class="js-send-button-container').replace('<textarea class="js-compose-text', '<textarea id="docked-textarea" class="js-compose-text');

    // inject tdp settings menu
    window.TD_mustaches['menus/topbar_menu.mustache'] = window.TD_mustaches['menus/topbar_menu.mustache'].replace('Settings{{/i}}</a> </li>', 'Settings{{/i}}</a> </li> <li class="is-selectable"><a href="#" data-action="tdpSettings">{{_i}}TweetDeck Player Settings{{/i}}</a></li>');

    // inject tweet indicator label
    window.TD_mustaches['status/tweet_single.mustache'] = window.TD_mustaches['status/tweet_single.mustache'].replace(/<\/div>$/, '</div><div class="tdp-color-label"></div>');
  }

  if (document.title === 'TweetDeck') {
    document.title = 'TweetDeck Player';
  } else {
    document.title = `TweetDeck Player - ${document.title}`;
  }

  var prev_focus;
  // mention/url highlight
  function handleChange (evt) {
    if (evt.target.id === 'account-safeguard-checkbox' || evt.target.id === 'inline-account-safeguard-checkbox') {
      var el = $('.js-compose-text');
      for (var i = 0; i < el.length; i++) {
        var text = $(el[i]).val();

        // 마지막 멘션 아이디가 셀렉션 지정되는 버그 회피
        var x = el[i];

        if (typeof x.dataset.initcompl === 'undefined') {
          x.dataset.initcompl = true;
        }
        if (prev_focus !== document.querySelector(':focus')) {
          setTimeout(() => {
            var v = $(x).val();
            if (window.getSelection().toString().length > 3) {
              $(x).focus().val('').val(v);
            }
          }, 100);
        }
      }
    }
    prev_focus = document.querySelector(':focus');
  }
  $(document).on({change: handleChange});

  // 맥용 한글 기본 입력기 이슈 해결
  // 엔터키로 트윗하기
  $(document).on('keydown', e => {
    if (!e.rep && e.which === 13) {
      // 엔터키로 트윗하기
      var el = document.activeElement;
      if (e.ctrlKey || config.enterKeyTweet === 'on' && el && el.classList.contains('js-compose-text') && e.shiftKey !== true &&
        ((el.tagName.toLowerCase() === 'input' && el.type === 'text') ||
        (el.tagName.toLowerCase() === 'textarea'))) {
        e.preventDefault();
        e.stopPropagation();
        $(document.activeElement).trigger($.Event('keypress', {which: e.which, keyCode: e.which, ctrlKey: true, rep: true}));
      }
    } else if (os.platform === 'darwin' && document.activeElement === document.body && e.key >= 'ㄱ' && e.key <= 'ㅣ') {
      e.preventDefault();
      e.stopPropagation();
      $(document.activeElement).trigger($.Event('keypress', {which: e.which}));
    } 
  });

  $(document).on('mouseover', '.tweet-timestamp', e => {
    const target = e.currentTarget;
    const time = target.getAttribute('data-time');
    const date = new Date(parseInt(time, 10));
    target.setAttribute('title', date.toLocaleString());
  });

  // Minimize Scroll Animation for Tweet Selection
  Math.min = (a, b) => {
    if (config.minimizeScrollAnimForTweetSel) {
      var obj = {};
      Error.captureStackTrace(obj, this);
      if (obj.stack.includes('calculateScrollDuration')) return 1;
    }
    return (a < b ? a : b);
  };

  // Shift/alt/ctrl key detect
  var setKeyCheck = function (event) {
    if (keyState.ctrl !== event.ctrlKey) {
      remote.getGlobal('keyState').ctrl = event.ctrlKey;
      keyState.ctrl = event.ctrlKey;
    }
    if (keyState.alt !== event.altKey) {
      remote.getGlobal('keyState').alt = event.altKey;
      keyState.alt = event.altKey;
    }
    if (keyState.shift !== event.shiftKey) {
      remote.getGlobal('keyState').shift = event.shiftKey;
      keyState.shift = event.shiftKey;
    }
  };

  document.addEventListener('keydown', setKeyCheck);
  document.addEventListener('keyup', setKeyCheck);
  document.addEventListener('mousedown', setKeyCheck);
  document.addEventListener('mouseup', setKeyCheck);

  // Favorite to Image Save
  var processFavorite = TD.services.TwitterClient.prototype.favorite.toString().substr(17);
  processFavorite = processFavorite.substr(0, processFavorite.length - 1);

  window.AutoSaveFav = AutoSaveFav;
  processFavorite = 'AutoSaveFav(e);' + processFavorite;
  TD.services.TwitterClient.prototype.favorite = Function('e,t,i', processFavorite);

  // Fast Retweet
  TD.services.TwitterStatus.prototype.retweet_direct = function (e) {
    if (config.enableFastRetweet && !keyState.shift) {
      var t, i, s, n;
      var r = this.isRetweeted;
      var o = TD.controller.clients.getClient(this.account.getKey());
      this.setRetweeted(!this.isRetweeted);
      this.animateRetweet(e.element);
      var n = function (e) {
      };
      var s = function (e) {
        var t = TD.core.defer.fail();
        if (403 === e.status || 404 === e.status) {
          window.toastErrorMessage((r ? TD.i('Failed: Unretweet -') : TD.i('Failed: Retweet -')) + ' ' + JSON.parse(e.responseText).errors[0].message);
        }
        403 !== e.status && 404 !== e.status || (t = this.refreshRetweet(o)),
        t.addErrback(function () {
          this.setRetweeted(r),
          n(e);
        }
        .bind(this));
      }
      .bind(this);
      var i = function (e) {
        e.error && s();
      };
      r ? (o.unretweet(this.id, i, s),
      t = () => {}) : (o.retweet(this.id, i, s),
      t = TD.controller.stats.retweet),
      t(this.getScribeItemData(), this.account.getUserID());
    } else {
      var e = 1 === TD.storage.accountController.getAccountsForService('twitter').length;
      this.isRetweeted && e ? (this.setRetweeted(!1),
      $(document).trigger('uiUndoRetweet', {
        tweetId: this.getMainTweet().id,
        from: this.account.getKey(),
      })) : new TD.components.ActionDialog(this);
    }
  };
  TD.services.TwitterStatus.prototype.refreshRetweet = function (e) {
    var t = new TD.core.defer.Deferred;
    return e.show(this.id, t.callback.bind(t), t.errback.bind(t)),
    t.addCallback(function (e) {
      this.setRetweeted(e.isRetweeted);
    }
    .bind(this)),
    t;
  };
  TD.services.TwitterStatus.prototype.animateRetweet = function (e) {
    var t = 'anim anim-slower anim-bounce-in';
    window.requestAnimationFrame(function () {
      e.find('a[rel="retweet"]').toggleClass(t, this.isRetweeted);
    }
    .bind(this));
  };
  TD.services.TwitterClient.prototype.retweet = function (e, t, i) {
    var s = this;
    var n = function (e) {
      t(e);
    };
    this.makeTwitterCall(this.API_BASE_URL + 'statuses/retweet/' + e + '.json', {
      id: e,
    }, 'POST', this.processTweet, n, i);
  };
  TD.services.TwitterClient.prototype.unretweet = function (e, t, i) {
    var s = this;
    var n = function (e) {
      t(e);
    };
    this.makeTwitterCall(this.API_BASE_URL + 'statuses/unretweet/' + e + '.json', {
      id: e,
    }, 'POST', this.processTweet, n, i);
  };
  TD.services.TwitterStatus.prototype.retweet_old = TD.services.TwitterStatus.prototype.retweet;
  TD.services.TwitterStatus.prototype.retweet = TD.services.TwitterStatus.prototype.retweet_direct;
  // TweetDeck Ready Check
  $(document).on('TD.ready', () => {
    ipcRenderer.send('page-ready-tdp', this);
        
    if (!Config.data.detectUpdate) window.toastMessage(TD.i(VERSION));
    setTimeout(() => {
      TD.settings.setUseStream(TD.settings.getUseStream());
      patchContentEditable();
    }, 3000);
    if (config.useStarForFavorite) {
      const cl = document.body.classList;
      cl.remove('hearty');
      cl.add('starry');
    }

    // Enable emojipad
    var emojiPadCSS = document.createElement('link');
    var dockBtn = document.querySelector('.emojipad--entry-point');
    document.body.appendChild(EmojiPad.element);
    dockBtn.addEventListener('click', e => {
      EmojiPad.show(e.clientX, e.clientY);

      var el = EmojiPad.element;
      var rect = el.getClientRects()[0];

      if (window.innerWidth - rect.left - 10 < rect.width) {
        el.style.left = `${window.innerWidth - rect.width - 10}px`;
      }
      if (window.innerHeight - rect.top - 10 < rect.height) {
        el.style.top = `${window.innerHeight - rect.height - 10}px`;
      }
    });
    document.body.addEventListener('click', e => {
      if (e.target !== dockBtn && EmojiPad.isOpen) EmojiPad.hide();
    }, false);
    EmojiPad.onEmojiClick = chr => {
      var txt = document.getElementById('docked-textarea');
      txt.value += chr;
      var evt = document.createEvent('HTMLEvents');
      evt.initEvent('change', false, true);
      txt.dispatchEvent(evt);
    };

    // Integrate TDP settings
    {
      var f = TD.controller.stats.navbarSettingsClick.bind({});
      TD.controller.stats.navbarSettingsClick = () => {
        var btn = document.querySelector('a[data-action=tdpSettings]');
        btn.addEventListener('click', e => {
          ipcRenderer.send('open-settings');
        }, false);
        f();
      };
    }
  });

});

ipcRenderer.on('redirect-url', function (event, url) {
  remote.getCurrentWebContents().loadURL(url);
});

ipcRenderer.on('toast-message', function (event, message) {
  window.toastMessage(message);
});
