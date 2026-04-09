export interface BcraUnifiedResponse {
    results: {
        identificacion: number;
        denominacion: string;
        periodos: Periodo[];
        causales?: Causal[]; // Opcional por si un CUIT no tiene cheques
    };
}

export interface Periodo {
    periodo: string;
    entidades: EntidadDetalle[];
}

export interface EntidadDetalle {
    entidad: string;
    situacion: number;
    monto: number;
}

export interface Causal {
    causal: string;
    entidades: {
        entidad: any;
        detalle: ChequeDetalle[];
    }[];
}

export interface ChequeDetalle {
    nroCheque: number;
    fechaRechazo: string;
    monto: number;
    fechaPago: string | null;
}