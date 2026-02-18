const path = require('path');
const express = require('express');
const mysql = require('mysql2/promise');

const app = express();
const port = process.env.PORT || 5000;

const db = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  user: process.env.DB_USER || 'trackii_app1',
  password: process.env.DB_PASSWORD || 'Trackii2026!',
  database: process.env.DB_NAME || 'trendingStatus',
  port: Number(process.env.DB_PORT || 3306),
  waitForConnections: true,
  connectionLimit: 10,
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));


async function initializeDatabase() {
  await db.query(
    `CREATE TABLE IF NOT EXISTS tasks (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      target INT NOT NULL
    )`,
  );

  await db.query(
    `CREATE TABLE IF NOT EXISTS daily_records (
      id INT AUTO_INCREMENT PRIMARY KEY,
      task_id INT,
      record_date DATE,
      quantity INT,
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    )`,
  );

  await db.query(
    `CREATE TABLE IF NOT EXISTS monthly_averages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      task_id INT,
      month DATE,
      average_quantity INT,
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    )`,
  );

  const [indexRows] = await db.query(
    `SELECT COUNT(1) AS total
     FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name = 'monthly_averages'
       AND index_name = 'ux_monthly_task_month'`,
  );

  if (!indexRows[0]?.total) {
    await db.query('CREATE UNIQUE INDEX ux_monthly_task_month ON monthly_averages (task_id, month)');
  }
}

function parseMonthParam(monthParam) {
  if (!monthParam || !/^\d{4}-\d{2}$/.test(monthParam)) {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
  return monthParam;
}

async function syncMonthlyAverage(taskId, date) {
  const month = String(date).slice(0, 7);

  const [avgRows] = await db.query(
    `SELECT ROUND(AVG(quantity)) AS average_quantity
     FROM daily_records
     WHERE task_id = ?
       AND DATE_FORMAT(record_date, '%Y-%m') = ?`,
    [taskId, month],
  );

  const averageQuantity = avgRows[0]?.average_quantity;

  if (averageQuantity === null || averageQuantity === undefined) {
    await db.query(
      `DELETE FROM monthly_averages
       WHERE task_id = ?
         AND DATE_FORMAT(month, '%Y-%m') = ?`,
      [taskId, month],
    );
    return;
  }

  await db.query(
    `INSERT INTO monthly_averages (task_id, month, average_quantity)
     VALUES (?, CONCAT(?, '-01'), ?)
     ON DUPLICATE KEY UPDATE average_quantity = VALUES(average_quantity)`,
    [taskId, month, averageQuantity],
  );
}

app.get('/api/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, message: 'Error de conexión a BD.' });
  }
});

app.get('/api/dashboard', async (req, res) => {
  try {
    const month = parseMonthParam(req.query.month);

    const [taskRows] = await db.query(
      `SELECT
          t.id,
          t.name,
          t.target,
          COALESCE(ma.average_quantity, dr.month_total, 0) AS achieved,
          ROUND((COALESCE(ma.average_quantity, dr.month_total, 0) / NULLIF(t.target, 0)) * 100, 1) AS compliance
       FROM tasks t
       LEFT JOIN monthly_averages ma
         ON ma.task_id = t.id
         AND DATE_FORMAT(ma.month, '%Y-%m') = ?
       LEFT JOIN (
         SELECT task_id, SUM(quantity) AS month_total
         FROM daily_records
         WHERE DATE_FORMAT(record_date, '%Y-%m') = ?
         GROUP BY task_id
       ) dr ON dr.task_id = t.id
       ORDER BY t.id`,
      [month, month],
    );

    const [trendRows] = await db.query(
      `SELECT
          DATE_FORMAT(ma.month, '%Y-%m') AS month,
          t.name,
          ma.average_quantity,
          t.target
       FROM monthly_averages ma
       JOIN tasks t ON t.id = ma.task_id
       WHERE ma.month >= DATE_SUB(CONCAT(?, '-01'), INTERVAL 5 MONTH)
         AND ma.month <= CONCAT(?, '-01')
       ORDER BY ma.month ASC, t.id ASC`,
      [month, month],
    );

    const totals = taskRows.reduce(
      (acc, row) => {
        acc.target += Number(row.target || 0);
        acc.achieved += Number(row.achieved || 0);
        return acc;
      },
      { target: 0, achieved: 0 },
    );

    const overallCompliance = totals.target
      ? Number(((totals.achieved / totals.target) * 100).toFixed(1))
      : 0;

    res.json({
      month,
      totals: {
        ...totals,
        compliance: overallCompliance,
      },
      tasks: taskRows,
      trend: trendRows,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'No se pudo cargar el dashboard.' });
  }
});

app.get('/api/tasks', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT id, name, target FROM tasks ORDER BY id');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: 'No se pudieron cargar las tareas.' });
  }
});

app.post('/api/tasks', async (req, res) => {
  const { name, target } = req.body;
  if (!name || !target || Number(target) <= 0) {
    return res.status(400).json({ message: 'Nombre y meta son requeridos.' });
  }

  try {
    const [result] = await db.query('INSERT INTO tasks (name, target) VALUES (?, ?)', [name, target]);
    res.status(201).json({ id: result.insertId, name, target: Number(target) });
  } catch (error) {
    res.status(500).json({ message: 'No se pudo crear la tarea.' });
  }
});

app.put('/api/tasks/:id', async (req, res) => {
  const { id } = req.params;
  const { name, target } = req.body;

  if (!name || !target || Number(target) <= 0) {
    return res.status(400).json({ message: 'Nombre y meta son requeridos.' });
  }

  try {
    const [result] = await db.query('UPDATE tasks SET name = ?, target = ? WHERE id = ?', [
      name,
      target,
      id,
    ]);

    if (!result.affectedRows) {
      return res.status(404).json({ message: 'Tarea no encontrada.' });
    }

    res.json({ id: Number(id), name, target: Number(target) });
  } catch (error) {
    res.status(500).json({ message: 'No se pudo actualizar la tarea.' });
  }
});

app.delete('/api/tasks/:id', async (req, res) => {
  const { id } = req.params;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM daily_records WHERE task_id = ?', [id]);
    await conn.query('DELETE FROM monthly_averages WHERE task_id = ?', [id]);
    const [result] = await conn.query('DELETE FROM tasks WHERE id = ?', [id]);

    if (!result.affectedRows) {
      await conn.rollback();
      return res.status(404).json({ message: 'Tarea no encontrada.' });
    }

    await conn.commit();
    res.status(204).send();
  } catch (error) {
    await conn.rollback();
    res.status(500).json({ message: 'No se pudo eliminar la tarea.' });
  } finally {
    conn.release();
  }
});

app.get('/api/records', async (req, res) => {
  const month = parseMonthParam(req.query.month);

  try {
    const [rows] = await db.query(
      `SELECT dr.id, dr.task_id, t.name AS task_name, dr.record_date, dr.quantity
       FROM daily_records dr
       JOIN tasks t ON t.id = dr.task_id
       WHERE DATE_FORMAT(dr.record_date, '%Y-%m') = ?
       ORDER BY dr.record_date DESC, dr.id DESC`,
      [month],
    );

    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: 'No se pudieron cargar los registros.' });
  }
});

app.post('/api/records', async (req, res) => {
  const { task_id: taskId, record_date: recordDate, quantity } = req.body;

  if (!taskId || !recordDate || !quantity || Number(quantity) <= 0) {
    return res.status(400).json({ message: 'Todos los campos son requeridos.' });
  }

  try {
    const [result] = await db.query(
      'INSERT INTO daily_records (task_id, record_date, quantity) VALUES (?, ?, ?)',
      [taskId, recordDate, quantity],
    );

    await syncMonthlyAverage(taskId, recordDate);

    res.status(201).json({
      id: result.insertId,
      task_id: Number(taskId),
      record_date: recordDate,
      quantity: Number(quantity),
    });
  } catch (error) {
    res.status(500).json({ message: 'No se pudo crear el registro.' });
  }
});

app.put('/api/records/:id', async (req, res) => {
  const { id } = req.params;
  const { task_id: taskId, record_date: recordDate, quantity } = req.body;

  if (!taskId || !recordDate || !quantity || Number(quantity) <= 0) {
    return res.status(400).json({ message: 'Todos los campos son requeridos.' });
  }

  try {
    const [previousRows] = await db.query('SELECT task_id, record_date FROM daily_records WHERE id = ?', [id]);

    if (!previousRows.length) {
      return res.status(404).json({ message: 'Registro no encontrado.' });
    }

    await db.query('UPDATE daily_records SET task_id = ?, record_date = ?, quantity = ? WHERE id = ?', [
      taskId,
      recordDate,
      quantity,
      id,
    ]);

    const previous = previousRows[0];
    await syncMonthlyAverage(previous.task_id, previous.record_date);
    await syncMonthlyAverage(taskId, recordDate);

    res.json({ id: Number(id), task_id: Number(taskId), record_date: recordDate, quantity: Number(quantity) });
  } catch (error) {
    res.status(500).json({ message: 'No se pudo actualizar el registro.' });
  }
});

app.delete('/api/records/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const [rows] = await db.query('SELECT task_id, record_date FROM daily_records WHERE id = ?', [id]);

    if (!rows.length) {
      return res.status(404).json({ message: 'Registro no encontrado.' });
    }

    await db.query('DELETE FROM daily_records WHERE id = ?', [id]);
    await syncMonthlyAverage(rows[0].task_id, rows[0].record_date);

    res.status(204).send();
  } catch (error) {
    res.status(500).json({ message: 'No se pudo eliminar el registro.' });
  }
});

app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, async () => {
  try {
    await initializeDatabase();
    console.log('Connected to MySQL database.');
  } catch (error) {
    console.error('Database not ready:', error.message);
  }
  console.log(`Server is running on http://localhost:${port}`);
});
