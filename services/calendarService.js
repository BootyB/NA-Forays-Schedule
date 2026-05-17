
// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const { google } = require('googleapis');
const logger = require('../utils/logger');

class CalendarService {
  constructor(pool) {
    this.pool = pool;
    
    this.oAuth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    
    this.oAuth2Client.setCredentials({
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN
    });
    
    this.calendar = google.calendar({ version: 'v3', auth: this.oAuth2Client });
    
    this.calendarIds = {
      BA: process.env.BA_CALENDAR_ID,
      DRS: process.env.DRS_CALENDAR_ID,
      FT: process.env.FT_CALENDAR_ID
    };
    
    logger.info('Calendar service initialized');
  }

  getCalendarId(run) {
    if (run.FT) return this.calendarIds.FT;
    if (run.DRS) return this.calendarIds.DRS;
    return this.calendarIds.BA;
  }

  async syncNewEvents() {
    const tableName = process.env.DB_TABLE_NAME;
    
    try {
      const rows = await this.pool.unsafe(
        `SELECT "ID", "Type", "Start", "ServerName", "RunDC", "DRS", "FT", "referenceLink" 
         FROM "${tableName}" 
         WHERE "isPosted" = 0 
           AND "Start" > $1 
           AND "isCancelled" = 0`,
        [Date.now()]
      );

      let posted = 0;
      for (const row of rows) {
        try {
          await this.createCalendarEvent(row);
          posted++;
        } catch (error) {
          logger.error('Error creating calendar event', {
            eventId: row.ID,
            error: error.message
          });
        }
      }

      if (posted > 0) {
        logger.info('Posted new events to Google Calendar', { count: posted });
      }
    } catch (error) {
      logger.error('Error syncing new events', { error: error.message });
    }
  }

  async createCalendarEvent(run) {
    const startDateTime = new Date(Number(run.Start));
    const endDateTime = new Date(Number(run.Start) + 7200000);
    
    const event = {
      summary: `${run.ServerName} - ${run.RunDC} - ${run.Type}`,
      start: { dateTime: startDateTime.toISOString() },
      end: { dateTime: endDateTime.toISOString() },
      description: run.referenceLink ? `Run Info: ${run.referenceLink}` : undefined
    };

    const calendarId = this.getCalendarId(run);
    const result = await this.calendar.events.insert({
      calendarId: calendarId,
      resource: event
    });

    const tableName = process.env.DB_TABLE_NAME;
    await this.pool.unsafe(
      `UPDATE "${tableName}" 
       SET "isPosted" = 1, google_event_id = $1 
       WHERE "ID" = $2`,
      [result.data.id, run.ID]
    );

    logger.debug('Calendar event created', { 
      eventId: run.ID, 
      calendarId,
      googleEventId: result.data.id 
    });
  }

  async updateEditedEvents() {
    const tableName = process.env.DB_TABLE_NAME;
    
    try {
      const rows = await this.pool.unsafe(
        `SELECT "ID", "Type", "Start", "ServerName", "RunDC", "DRS", "FT", google_event_id, "referenceLink"
         FROM "${tableName}" 
         WHERE "isPosted" = 1 
           AND "isUpdated" = 1 
           AND "isDeleted" = 0 
           AND google_event_id IS NOT NULL
           AND "Start" > $1`,
        [Date.now()]
      );

      let updated = 0;
      for (const row of rows) {
        try {
          await this.updateCalendarEvent(row);
          
          await this.pool.unsafe(
            `UPDATE "${tableName}" SET "isUpdated" = 0 WHERE "ID" = $1`,
            [row.ID]
          );
          
          updated++;
        } catch (error) {
          logger.error('Error updating calendar event', {
            eventId: row.ID,
            error: error.message
          });
        }
      }

      if (updated > 0) {
        logger.info('Updated edited events on Google Calendar', { count: updated });
      }
    } catch (error) {
      logger.error('Error updating edited events', { error: error.message });
    }
  }

  async updateCalendarEvent(run) {
    const startDateTime = new Date(Number(run.Start));
    const endDateTime = new Date(Number(run.Start) + 7200000);
    
    const event = {
      summary: `${run.ServerName} - ${run.RunDC} - ${run.Type}`,
      start: { dateTime: startDateTime.toISOString() },
      end: { dateTime: endDateTime.toISOString() },
      description: run.referenceLink ? `Run Info: ${run.referenceLink}` : undefined
    };

    const calendarId = this.getCalendarId(run);
    
    await this.calendar.events.update({
      calendarId: calendarId,
      eventId: run.google_event_id,
      resource: event
    });

    logger.debug('Calendar event updated', { 
      eventId: run.ID, 
      calendarId,
      googleEventId: run.google_event_id 
    });
  }

  async deletePastEvents() {
    const tableName = process.env.DB_TABLE_NAME;
    
    try {
      const rows = await this.pool.unsafe(
        `SELECT "ID", "Start", "DRS", "FT", google_event_id, "isCancelled" 
         FROM "${tableName}" 
         WHERE "isPosted" = 1 
           AND "isDeleted" = 0 
           AND google_event_id IS NOT NULL`,
        []
      );

      const currentTime = Date.now();
      let deleted = 0;

      for (const row of rows) {
        const eventEndTime = Number(row.Start) + 7200000;
        const shouldDelete = row.isCancelled || currentTime > eventEndTime + 10800000;
        
        if (shouldDelete) {
          try {
            await this.deleteCalendarEvent(row);
            deleted++;
          } catch (error) {
            if (error.code === 404 || error.message?.includes('notFound')) {
              await this.markEventDeleted(row.ID);
              logger.debug('Calendar event already deleted', { eventId: row.ID });
            } else {
              logger.error('Error deleting calendar event', {
                eventId: row.ID,
                error: error.message
              });
            }
          }
        }
      }

      if (deleted > 0) {
        logger.info('Deleted past/cancelled events from Google Calendar', { count: deleted });
      }
    } catch (error) {
      logger.error('Error deleting past events', { error: error.message });
    }
  }

  async deleteCalendarEvent(run) {
    const calendarId = this.getCalendarId(run);
    
    await this.calendar.events.delete({
      calendarId: calendarId,
      eventId: run.google_event_id
    });

    await this.markEventDeleted(run.ID);

    logger.debug('Calendar event deleted', { 
      eventId: run.ID,
      calendarId,
      reason: run.isCancelled ? 'cancelled' : 'past'
    });
  }

  async markEventDeleted(eventId) {
    const tableName = process.env.DB_TABLE_NAME;
    await this.pool.unsafe(
      `UPDATE "${tableName}" SET "isDeleted" = 1 WHERE "ID" = $1`,
      [eventId]
    );
  }

  async syncAll() {
    logger.debug('Starting calendar sync cycle');
    
    await this.syncNewEvents();
    await this.updateEditedEvents();
    await this.deletePastEvents();
    
    logger.debug('Calendar sync cycle complete');
  }
}

module.exports = CalendarService;
