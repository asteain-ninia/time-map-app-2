// プリロードスクリプト
window.electron = {
    fs: {
      readFile: (path, options) => {
        return new Promise((resolve, reject) => {
          require('fs').readFile(path, options, (err, data) => {
            if (err) reject(err);
            else resolve(data);
          });
        });
      },
      writeFile: (path, data, options) => {
        return new Promise((resolve, reject) => {
          require('fs').writeFile(path, data, options, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      },
      exists: (path) => {
        return new Promise((resolve) => {
          require('fs').access(path, (err) => {
            resolve(!err);
          });
        });
      },
      mkdir: (path, options) => {
        return new Promise((resolve, reject) => {
          require('fs').mkdir(path, options, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      }
    }
  };