class weidapaoStorage {
  constructor(projectName) {
    this.projectName = projectName;
    this.ready(this.projectName);
  }

  ready() {
    return new Promise((resolve, reject) => {
      if (this.db) {
        resolve(this);
      } else {
        this.objectStoreName = "weidapao-store";
        const request = indexedDB.open(this.projectName, 1);

        request.onsuccess = (event) => {
          this.db = event.target.result;
          resolve(this);
        };

        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(this.objectStoreName)) {
            db.createObjectStore(this.objectStoreName);
          }
        };

        request.onerror = (event) => {
          reject(event);
        };
      }
    });
  }

  init(request, callback) {
    return new Promise((resolve, reject) => {
      const success = (value) => {
        if (callback && typeof callback === "function") {
          callback(value);
        }
        resolve(this);
      };
      const fail = (event) => {
        if (callback && typeof callback === "function") {
          callback(event);
        }
      };
      this.ready()
        .then(() => {
          request(success, fail);
        })
        .catch(fail);
    });
  }

  setItem(key, value, callback) {
    return this.init((success, fail) => {
      const request = this.db
        .transaction(this.objectStoreName, "readwrite")
        .objectStore(this.objectStoreName)
        .put(value, key);
      request.onsuccess = () => {
        success(value);
      };
      request.onerror = fail;
    }, callback);
  }

  getItem(key, callback) {
    return this.init((success, fail) => {
      const request = this.db
        .transaction(this.objectStoreName)
        .objectStore(this.objectStoreName)
        .get(key);
      request.onsuccess = () => {
        success(key);
      };
      request.onerror = fail;
    }, callback);
  }

  removeItem(key, callback) {
    return this.init((success, fail) => {
      const request = this.db
        .transaction(this.objectStoreName, "readwrite")
        .objectStore(this.objectStoreName)
        .delete(key);
      request.onsuccess = () => {
        success(key);
      };
      request.onerror = fail;
    }, callback);
  }
}
