'use strict';

const cron = require('node-cron');
const { getDb } = require('../../config/database');
const { executeJob } = require('./jobs.executor');
const logger = require('../../services/logger.service');

const _tasks = new Map(); // jobId → cron.ScheduledTask

function intervalToCron(minutes) {
  const m = parseInt(minutes, 10);
  if (m < 60) return `*/${m} * * * *`;
  if (m === 60) return '0 * * * *';
  const hours = Math.floor(m / 60);
  return `0 */${hours} * * *`;
}

function getCronExpression(job) {
  if (job.schedule_type === 'cron') return job.schedule_value;
  return intervalToCron(job.schedule_value);
}

function registerJob(job) {
  if (_tasks.has(job.id)) {
    unregisterJob(job.id);
  }
  const expression = getCronExpression(job);
  if (!cron.validate(expression)) {
    logger.warn(`Job "${job.name}" tiene expresión cron inválida: ${expression}`, { job_id: job.id });
    return;
  }
  const task = cron.schedule(expression, async () => {
    logger.info(`Scheduler disparando job "${job.name}"`, { job_id: job.id });
    try {
      await executeJob(job.id);
    } catch (err) {
      logger.error(`Error inesperado en scheduler para job "${job.name}"`, { job_id: job.id, error: err.message });
    }
  });
  _tasks.set(job.id, { task, expression, job });
  logger.info(`Job "${job.name}" registrado en scheduler`, { job_id: job.id, expression });
}

function unregisterJob(jobId) {
  const entry = _tasks.get(jobId);
  if (entry) {
    entry.task.stop();
    _tasks.delete(jobId);
    logger.info(`Job desregistrado del scheduler`, { job_id: jobId });
  }
}

function reloadJob(job) {
  unregisterJob(job.id);
  if (job.is_active) {
    registerJob(job);
  }
}

async function initScheduler() {
  const db = getDb();
  const activeJobs = db.prepare('SELECT * FROM jobs WHERE is_active = 1').all();
  for (const job of activeJobs) {
    registerJob(job);
  }
  logger.info(`Scheduler iniciado con ${activeJobs.length} jobs activos`);
}

function stopScheduler() {
  for (const [jobId, { task }] of _tasks) {
    task.stop();
  }
  _tasks.clear();
  logger.info('Scheduler detenido');
}

function getSchedulerStatus() {
  const statuses = [];
  for (const [jobId, { expression, job }] of _tasks) {
    statuses.push({
      job_id: jobId,
      job_name: job.name,
      expression,
      active: true,
    });
  }
  return statuses;
}

module.exports = { initScheduler, stopScheduler, registerJob, unregisterJob, reloadJob, getSchedulerStatus };
