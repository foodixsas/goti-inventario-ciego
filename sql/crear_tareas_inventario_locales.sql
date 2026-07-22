-- Tabla para tareas de inventario locales (Carga Locales module)
-- Permite al admin solicitar tareas que el worker procesara

CREATE TABLE IF NOT EXISTS goti.tareas_inventario_locales (
    id SERIAL PRIMARY KEY,
    bodega VARCHAR(50) NOT NULL,
    fecha DATE NOT NULL,
    accion VARCHAR(50) NOT NULL,  -- 'actualizar_cantidad' o 'toma_fisica'
    estado VARCHAR(20) DEFAULT 'pendiente',  -- pendiente, en_proceso, completado, error
    solicitado_por VARCHAR(100),
    solicitado_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    worker_lock VARCHAR(50),
    timestamp_inicio TIMESTAMP,
    timestamp_fin TIMESTAMP,
    total_productos INTEGER,
    url_contifico TEXT,
    error_msg TEXT
);

-- Indices para mejor performance
CREATE INDEX IF NOT EXISTS idx_tareas_inv_loc_estado ON goti.tareas_inventario_locales(estado);
CREATE INDEX IF NOT EXISTS idx_tareas_inv_loc_fecha ON goti.tareas_inventario_locales(fecha);
CREATE INDEX IF NOT EXISTS idx_tareas_inv_loc_solicitado ON goti.tareas_inventario_locales(solicitado_at DESC);
