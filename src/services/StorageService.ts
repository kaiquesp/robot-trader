// src/robot/services/StorageService.ts

import fs from 'fs';

export class StorageService {
  static loadJson<T>(filePath: string, defaultValue: T): T {
    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(raw) as T;
      } catch {
        return defaultValue;
      }
    }
    return defaultValue;
  }

  static saveJson<T>(filePath: string, data: T) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }
}
