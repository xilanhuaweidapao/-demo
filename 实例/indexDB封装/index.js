// 传入了 callback的情况下还支持 .then ?
// 为什么要这么设计 解决了什么问题 ？
class WeidapaoStorage {
  constructor(projectName) {
    this.projectName = projectName;
    this.ready(this.projectName);
  }

  ready(projectName = this.projectName) {
    return new Promise((resolve, reject) => {
      if (this.db) {
        resolve(this);
      } else {
        this.objectStoreName = "wedapao-store";
        const request = window.indexedDB.open(projectName, 1);

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
          callback(false, value);
        }
        resolve(value);
      };

      const fail = (event) => {
        if (callback && typeof callback === "function") {
          callback(false, event);
        }
        reject(event);
      };

      this.ready()
        .then(() => {
          request(success, fail);
        })
        .catch(error);
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
        success(request.result);
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
