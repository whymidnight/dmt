import { dateFns, program, SeededRandom, log, timeutils } from 'dmt/common';

const { parse, isAfter, addDays, isSameDay, isSameMinute, subMinutes } = dateFns;

import ScopedNotifier from './base/scopedNotifier.js';

import { isReloadableNotifications } from './lib/isReloadableNotifications.js';
import parseTimeToday from './lib/parseTimeToday.js';
import convertDateToEUFormat from './lib/convertDateToEUFormat.js';
import convertTimeTo24hFormat from './lib/convertTimeTo24hFormat.js';
import describeNearTime from './lib/describeNearTime.js';
import localize from './lib/localize.js';
import { evaluateTimespan } from './lib/evaluateTimespan.js';

import dateTemplate from './lib/dateTemplate.js';

const { formatFutureDistance } = timeutils;

const CLOCK_SYMBOL = '🕛';
const NOW_SYMBOL = '🫵';
const TOMORROW_SYMBOL = '⏳';
const CALENDAR_SYMBOL = '🗓️';
const EXCLAMATION_SYMBOL = '❗';
const NOTIFIER_DEFAULT_TIME = '10:00';
function pseudoRandomNumberFromString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }

  const seededRandom = Math.sin(hash) * 10000;
  const randomDecimal = seededRandom - Math.floor(seededRandom);

  return Math.floor(randomDecimal * 30);
}

class DateNotifier extends ScopedNotifier {
  constructor(
    notifications,
    { symbol = '📅', title, color, ttl, highPriority, notifyDayBeforeAt, app, defaultTime, notifyMinutesBefore = 0, notifyDaysBefore = [], user, users } = {},
    decommissionable = false
  ) {
    super(symbol, decommissionable);

    this.notifications = Array(notifications).flat(Infinity);
    this.app = app;

    for (const n of this.notifications) {
      n.when = Array(n.when)
        .flat()
        .map(w => this.parseMonthlyFrequency(w, this.getBaseSeed(w, n)))
        .flat();
    }

    this.title = title;
    this.symbol = symbol;
    this.color = color;
    this.ttl = ttl;
    this.highPriority = !!highPriority;

    this.notifyDayBeforeAt = notifyDayBeforeAt;
    this.notifyMinutesBefore = Array.isArray(notifyMinutesBefore) ? notifyMinutesBefore : [notifyMinutesBefore];
    this.notifyDaysBefore = notifyDaysBefore;

    this.defaultTime = defaultTime;

    this.user = user || users;
  }

  getBaseSeed(whenStr, entry) {
    const titleStrOrArray = entry.title || this.title || '';
    const title = Array.isArray(titleStrOrArray) ? titleStrOrArray.join('') : titleStrOrArray;
    const msg = Array.isArray(entry.msg) ? entry.msg.join('') : entry.msg;

    const entryUser = entry.user || entry.users;
    const user = entryUser == undefined ? this.user : entryUser;

    let str = whenStr;

    str += title || '';
    str += msg || '';
    str += user || '';

    return pseudoRandomNumberFromString(str);
  }

  parseMonthlyFrequency(whenStr, baseSeed = 0) {
    const regexMonthly = /^(\d+)x month(?:ly)?\b/i;
    const regexWeekly = /^(\d+)x week(?:ly)?\b/i;

    const matchesMonthly = whenStr.trim().match(regexMonthly);
    const matchesWeekly = whenStr.trim().match(regexWeekly);

    const AVG_DAYS_IN_MONTH = 30;

    const MAX_MONTHLY = 15;

    const FROM_HOUR = 8;
    const TO_HOUR = 20;

    const list = [];
    const year = new Date().getFullYear();

    let freqMonthly;

    if (matchesMonthly) {
      freqMonthly = matchesMonthly[1];
    }

    if (matchesWeekly) {
      freqMonthly = 4 * matchesWeekly[1];
    }

    if (freqMonthly > MAX_MONTHLY) {
      log.red(`⚠️  Converting '${whenStr}' to '${MAX_MONTHLY}x monthly' (${this.ident})`);
      freqMonthly = Math.min(MAX_MONTHLY, freqMonthly);
    }

    if (freqMonthly) {
      const regexTime = /\bat (.*)$/i;

      const matchesTime = whenStr.trim().match(regexTime);

      let _time;

      if (matchesTime) {
        _time = matchesTime[1];
      }

      for (let month = 1; month <= 12; month++) {
        const seed = baseSeed + 2 * month + year;

        const rand = new SeededRandom(seed);

        const step = Math.round(AVG_DAYS_IN_MONTH / freqMonthly);

        for (let x = 0; x < freqMonthly; x++) {
          const time = _time || `${FROM_HOUR + Math.floor((TO_HOUR - FROM_HOUR) * rand.next())}:00`;
          const day = freqMonthly == 1 ? `${12 + Math.floor(6 * rand.next())}` : `${x * step + 1 + Math.floor(0.75 * step * rand.next())}`;
          list.push(`${day}.${month}. ${time}`);
        }
      }

      return list;
    }

    return whenStr;
  }

  checkNotificationTimes(entry) {
    const now = new Date();

    const {
      when,
      msg: msgStrOrArray,
      notifyMinutesBefore: _notifyMinutesBefore,
      notifyDayBeforeAt: _notifyDayBeforeAt,
      notifyDaysBefore: _notifyDaysBefore,
      defaultTime: _defaultTime,
      color,
      ttl,
      from,
      until,
      highPriority: _highPriority,
      url,
      id
    } = entry;

    const msg = Array.isArray(msgStrOrArray) ? this.randomElement(msgStrOrArray) : msgStrOrArray;

    const titleStrOrArray = entry.title || this.title || '';
    const title = Array.isArray(titleStrOrArray) ? this.randomElement(titleStrOrArray) : titleStrOrArray;

    const symbolStrOrArray = entry.symbol || this.symbol;
    const _symbol = Array.isArray(symbolStrOrArray) ? this.randomElement(symbolStrOrArray) : symbolStrOrArray;

    const notifyMinutesBefore = Array.isArray(_notifyMinutesBefore)
      ? _notifyMinutesBefore
      : _notifyMinutesBefore !== undefined
      ? [_notifyMinutesBefore]
      : this.notifyMinutesBefore;
    const highPriority = _highPriority == undefined ? this.highPriority : _highPriority;

    const notifyDayBeforeAt = Array((_notifyDayBeforeAt == undefined ? this.notifyDayBeforeAt : _notifyDayBeforeAt || []) || []).flat();

    const __notifyDaysBefore = _notifyDaysBefore || this.notifyDaysBefore;

    const ___notifyDaysBefore = Array.isArray(__notifyDaysBefore) ? __notifyDaysBefore : [__notifyDaysBefore];
    const omitOnDayOfEvent = !!___notifyDaysBefore.find(x => x == -1);
    const notifyDaysBefore = ___notifyDaysBefore.filter(x => x != 0 && x != -1);
    if (notifyDayBeforeAt.length > 0 && !notifyDaysBefore.includes(1)) {
      notifyDaysBefore.push(1);
    }

    let defaultTime = _defaultTime || this.defaultTime;
    if (Array.isArray(defaultTime) && defaultTime.length == 1) {
      defaultTime = defaultTime[0];
    }

    const entryUser = entry.user || entry.users;
    const user = entryUser == undefined ? this.user : entryUser;

    const list = when.map(t => this.getTimepoint({ t, defaultTime }));

    for (const { timepoint, time, isUnspecifiedTime } of list) {
      const o = {
        deviceId: program.device.id,
        highPriority: false,
        _title: title,
        _msg: msg,
        color: color || this.color,
        ttl: ttl || this.ttl,
        user,
        id,
        url,
        eventTime: timepoint,
        data: entry.data || {}
      };

      const { strToday, strTomorrow, strAt, strIn, capitalizeFirstLetter } = localize(program);

      const { isWithin } = evaluateTimespan({ date: timepoint, from, until });

      if (isWithin) {
        const importantEvent = list.length == 1 && notifyDaysBefore.filter(el => el != 1).length > 0;

        if (!omitOnDayOfEvent) {
          const minutesBefore = isUnspecifiedTime ? [0] : notifyMinutesBefore.sort((a, b) => b - a);
          minutesBefore.forEach((min, index) => {
            const notificationTime = subMinutes(timepoint, min);

            if (isSameMinute(now, notificationTime)) {
              const { datetime, inTime, isNow } = describeNearTime(timepoint);

              const isLastNotification = index === minutesBefore.length - 1;

              const brevityTagline = notifyMinutesBefore.length >= 2 && min <= 30 && isLastNotification;

              const _tagline =
                isNow && msg
                  ? undefined
                  : `${isNow ? NOW_SYMBOL : CLOCK_SYMBOL}${brevityTagline ? '' : ` ${datetime}`}${
                      inTime ? ` [ ${brevityTagline ? capitalizeFirstLetter(inTime) : inTime} ]` : ''
                    }${!isNow && min <= 30 ? EXCLAMATION_SYMBOL : ''}`;

              const __tagline = isUnspecifiedTime ? undefined : _tagline;

              let tagline = __tagline;

              if (!__tagline && !msg) {
                tagline = `[ ${strToday} ]`;
              }

              const symbol = isLastNotification && (importantEvent || this.isLastEvent({ list, timepoint })) ? `${_symbol}${EXCLAMATION_SYMBOL}` : _symbol;

              const pushTitle = `${symbol} ${title}`.trim();
              const pushMsg = msg ? `${tagline ? `${tagline}\n\n` : ''}${msg}` : tagline;

              this.callback({
                ...o,
                title: pushTitle,
                msg: pushMsg,
                symbol,
                tagline,
                app: this.app,
                isToday: true,
                highPriority: isLastNotification ? highPriority : false
              });
            }
          });
        }

        for (const daysBefore of notifyDaysBefore) {
          if (isSameDay(timepoint, addDays(now, daysBefore))) {
            const times = [];

            if (daysBefore == 1 && notifyDayBeforeAt.length > 0) {
              times.push(...notifyDayBeforeAt);
            } else {
              times.push(time);
            }

            for (const t of times) {
              const notificationTime = parseTimeToday(t, title);

              if (isSameMinute(now, notificationTime)) {
                const isDayBefore = daysBefore == 1;

                const symbol = _symbol;

                const pushTitle = `${symbol} ${title}`;

                const inDays = `${strIn} ${formatFutureDistance(timepoint, { lang: program.lang() })}`;
                const tagline = `${isDayBefore ? TOMORROW_SYMBOL : CALENDAR_SYMBOL} ${isDayBefore ? strTomorrow : capitalizeFirstLetter(inDays)} ${
                  isUnspecifiedTime ? '' : `${strAt} ${time}`
                }`.trim();

                const pushMsg = msg ? `${tagline ? `${tagline}\n\n` : ''}${msg}` : tagline;

                this.callback({ ...o, title: pushTitle, msg: pushMsg, app: this.app, tagline, isDayBefore, inDays, symbol });
              }
            }
          }
        }
      }
    }
  }

  getTimepoint({ t, defaultTime }) {
    const [_date, _time] = t.replace(' at ', ' ').split(' ');

    const __time = _time || defaultTime || NOTIFIER_DEFAULT_TIME;

    const isUnspecifiedTime = !_time && !defaultTime;

    const time = convertTimeTo24hFormat(__time);

    const defaultYear = new Date().getFullYear();
    const timepoint = parse(`${convertDateToEUFormat(_date, defaultYear)} ${time}`, `${dateTemplate} H:mm`, new Date());

    return { timepoint, time, isUnspecifiedTime };
  }

  isLastEvent({ list, timepoint }) {
    if (list.length > 1) {
      return !list.find(t => isAfter(t.timepoint, timepoint));
    }
  }

  check() {
    for (const entry of this.notifications) {
      this.checkNotificationTimes(entry);
    }
  }
}

export default function dateNotifier(notifications, options = {}) {
  const decommissionable = isReloadableNotifications(new Error(), import.meta.url);

  return new DateNotifier(notifications, options, decommissionable);
}
