export interface DeudasClient {
    status: number;
    results: Results;
}

export interface Results {
    identificacion: number;
    denominacion: string;
    periodos: Periodo[];
}

export interface Periodo {
    periodo: string;
    entidades: Entidade[];
}

export interface Entidade {
    entidad: Entidad;
    situacion: number;
    monto: number;
    enRevision: boolean;
    procesoJud: boolean;
}

export enum Entidad {
    BancoDeGaliciaYBuenosAiresSA = "BANCO DE GALICIA Y BUENOS AIRES S.A.",
    BancoDeLaNacionArgentina = "BANCO DE LA NACION ARGENTINA",
    BancoSantanderArgentinaSA = "BANCO SANTANDER ARGENTINA S.A.",
    BancoSupervielleSA = "BANCO SUPERVIELLE S.A.",
    MercadolibreSRL = "MERCADOLIBRE S.R.L.",
}
