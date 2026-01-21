// SPDX-FileCopyrightText: 2024-2026 BootyB
// SPDX-License-Identifier: GPL-3.0-or-later

const logger = require('../utils/logger');
class ServiceLocator {
  static #instance = null;
  #services = new Map();
  #initialized = false;

  constructor() {
    if (ServiceLocator.#instance) {
      return ServiceLocator.#instance;
    }
    ServiceLocator.#instance = this;
  }

  static getInstance() {
    if (!ServiceLocator.#instance) {
      ServiceLocator.#instance = new ServiceLocator();
    }
    return ServiceLocator.#instance;
  }

  register(name, service) {
    if (this.#services.has(name)) {
      logger.warn(`Service '${name}' is being overwritten`);
    }
    this.#services.set(name, service);
    logger.debug(`Service registered: ${name}`);
    return this;
  }

  registerAll(services) {
    for (const [name, service] of Object.entries(services)) {
      if (service !== null && service !== undefined) {
        this.register(name, service);
      }
    }
    return this;
  }

  get(name) {
    if (!this.#services.has(name)) {
      throw new Error(`Service '${name}' not found. Available services: ${this.listServices().join(', ')}`);
    }
    return this.#services.get(name);
  }

  has(name) {
    return this.#services.has(name);
  }

  getMany(...names) {
    const result = {};
    for (const name of names) {
      result[name] = this.get(name);
    }
    return result;
  }

  listServices() {
    return Array.from(this.#services.keys());
  }

  markInitialized() {
    this.#initialized = true;
    logger.info('ServiceLocator initialized', { services: this.listServices() });
  }

  isInitialized() {
    return this.#initialized;
  }

  clear() {
    this.#services.clear();
    this.#initialized = false;
    logger.debug('ServiceLocator cleared');
  }
}

module.exports = ServiceLocator.getInstance();
