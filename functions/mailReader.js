const Imap = require('imap');
const { simpleParser } = require('mailparser');

const extractCode = (text) => {
  const m = String(text || '').match(/^\s*(\d{5})\s*$/m);
  return m ? m[1] : null;
}

const findTrashBoxName = (boxes, prefix = '') => {
  for (const [name, box] of Object.entries(boxes || {})) {
    const fullName = prefix ? `${prefix}${name}` : name;

    const attribs = (box && box.attribs) ? box.attribs.map(a => a.toLowerCase()) : [];
    const lname = fullName.toLowerCase();

    if (attribs.includes('\\trash')) return fullName;

    if (
      lname.includes('trash') ||
      lname.includes('papelera') ||
      lname.includes('[gmail]/trash') ||
      lname.includes('[google mail]/trash') ||
      lname.includes('[gmail]/papelera')
    ) return fullName;

    if (box && box.children) {
      const found = findTrashBoxName(box.children, `${fullName}${box.delimiter || '/'}`);
      if (found) return found;
    }
  }
  return null;
}

const waitForMailCode = ({
  userEmail,
  appPassword,
  fromEmail,
  timeoutMs = 120000,
  pollMs = 3000,
}) => {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: userEmail,
      password: appPassword,
      host: 'imap.gmail.com',
      port: 993,
      tls: true,
      tlsOptions: { servername: 'imap.gmail.com' },
    });

    let timer = null;
    let interval = null;
    let settled = false;
    let busy = false;

    let trashBoxName = null;

    const finish = (err, code) => {
      if (settled) return;
      settled = true;

      clearTimeout(timer);
      clearInterval(interval);

      try { imap.end(); } catch (_) {}

      if (err) return reject(err);
      resolve(code);
    };

    const openInbox = (cb) => imap.openBox('INBOX', false, cb);

    const loadTrashBox = (cb) => {
      imap.getBoxes((err, boxes) => {
        if (err) return cb(err);
        trashBoxName = findTrashBoxName(boxes);

        if (!trashBoxName) trashBoxName = '[Gmail]/Trash';

        cb(null);
      });
    };

    const moveToTrash = (uid, cb) => {
      imap.move(uid, trashBoxName, (err) => {
        if (!err) return cb(null);

        const fallbacks = [
          '[Gmail]/Trash',
          '[Google Mail]/Trash',
          '[Gmail]/Papelera',
          'Papelera',
          'Trash',
        ];

        const tryNext = (i) => {
          if (i >= fallbacks.length) return cb(err);
          imap.move(uid, fallbacks[i], (e2) => {
            if (!e2) return cb(null);
            tryNext(i + 1);
          });
        };

        tryNext(0);
      });
    };

    const deleteFallback = (uid, cb) => {
      // Último recurso: \Deleted + expunge
      imap.addFlags(uid, ['\\Seen', '\\Deleted'], (err) => {
        if (err) return cb(err);
        imap.expunge((err2) => cb(err2 || null));
      });
    };

    const checkUnreadFrom = () => {
      if (busy || settled) return;
      busy = true;

      imap.search(['UNSEEN', ['FROM', fromEmail]], (err, results) => {
        if (err || !results || results.length == 0) {
          busy = false;
          return;
        }

        const uid = results[results.length - 1];
        const fetcher = imap.fetch(uid, { bodies: '' });

        fetcher.on('message', (msg) => {
          msg.on('body', async (stream) => {
            try {
              const parsed = await simpleParser(stream);

              const fromText = parsed.from?.text || '';
              if (!fromText.toLowerCase().includes(fromEmail.toLowerCase())) {
                busy = false;
                return;
              }

              const subject = parsed.subject || '';
              const body = parsed.text || parsed.html || '';
              const code = extractCode(subject + "\n" + body);

              if (!code) {
                busy = false;
                return;
              }

              // Primero marcar como leído
              imap.addFlags(uid, ['\\Seen'], (eSeen) => {
                if (eSeen) console.log('Error al marcar \\Seen:', String(eSeen));

                // Preferido: mover a Papelera
                moveToTrash(uid, (eMove) => {
                  if (!eMove) return finish(null, code);

                  console.log('Error al mover a Papelera (move):', String(eMove));

                  // Fallback: borrar por flags
                  deleteFallback(uid, (eDel) => {
                    if (eDel) console.log('Error borrando por flags:', String(eDel));
                    finish(null, code); // igual devolvemos el código
                  });
                });
              });

            } catch (e) {
              console.log(String(e));
              busy = false;
            }
          });
        });

        fetcher.once('error', (e) => {
          console.log(String(e));
          busy = false;
        });

        fetcher.once('end', () => {
          if (!settled) busy = false;
        });
      });
    };

    imap.once('ready', () => {
      openInbox((err) => {
        if (err) return finish(err);

        loadTrashBox((eBoxes) => {
          if (eBoxes) console.log('No pude leer buzones (getBoxes):', String(eBoxes));

          // Chequeo inmediato y luego polling
          checkUnreadFrom();
          interval = setInterval(checkUnreadFrom, pollMs);
        });
      });
    });

    imap.once('error', (err) => finish(err));
    imap.once('end', () => {
      if (!settled) finish(new Error('Conexión IMAP finalizó antes de capturar el código.'));
    });

    timer = setTimeout(() => {
      finish(new Error('Timeout esperando el código por email.'));
    }, timeoutMs);

    imap.connect();
  });
};

module.exports = { waitForMailCode };
