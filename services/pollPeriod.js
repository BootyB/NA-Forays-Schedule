// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const { DateTime } = require('luxon');

const RESET_INTERVAL_WEEKS = 2;
const TIMEZONE = 'America/New_York';
const REFERENCE_RESET_DATE = DateTime.fromObject({
  year: 2026,
  month: 1,
  day: 1,
  hour: 0,
  minute: 0,
  second: 0,
  millisecond: 0
}, { zone: TIMEZONE });

function getMostRecentPollReset(fromDate = null) {
  const now = fromDate || DateTime.now().setZone(TIMEZONE);
  const weeksSinceReference = Math.floor(now.diff(REFERENCE_RESET_DATE, 'weeks').weeks);
  const periodsElapsed = Math.floor(weeksSinceReference / RESET_INTERVAL_WEEKS);
  const resetPoint = REFERENCE_RESET_DATE.plus({ weeks: periodsElapsed * RESET_INTERVAL_WEEKS });

  return now < resetPoint
    ? resetPoint.minus({ weeks: RESET_INTERVAL_WEEKS })
    : resetPoint;
}

function getCurrentPollPeriodId() {
  return getMostRecentPollReset().toFormat('yyyy-MM-dd');
}

function getPollPeriodBounds(periodId) {
  const resetPoint = DateTime.fromFormat(periodId, 'yyyy-MM-dd', { zone: TIMEZONE });
  if (!resetPoint.isValid) {
    throw new Error(`Invalid poll period ID: ${periodId}`);
  }

  const endPoint = resetPoint.plus({ weeks: RESET_INTERVAL_WEEKS }).minus({ milliseconds: 1 });
  return {
    start: resetPoint.toMillis(),
    end: endPoint.toMillis(),
    startISO: resetPoint.toISO(),
    endISO: endPoint.toISO()
  };
}

module.exports = {
  RESET_INTERVAL_WEEKS,
  TIMEZONE,
  getMostRecentPollReset,
  getCurrentPollPeriodId,
  getPollPeriodBounds
};
