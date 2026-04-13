import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class BcraService {

  private http = inject(HttpClient);

  // USA EL PREFIJO EXACTO QUE PUSIMOS EN EL PROXY (api-bcra)
  // IMPORTANTE: Sin barra al final

  apiUrlLucas = 'http://192.168.2.106:3000/BCRA-debts';

  apiExcel = 'http://192.168.2.106:3000/BCRA-report'

  private baseUrl = 'https://api.bcra.gob.ar/centraldedeudores/v1.0/Deudas';

  getDeudas(cuits: any): Observable<any> {
    // return this.http.get(`${this.baseUrl}/Historicas/${cuit}`);
    return this.http.post(`${this.apiUrlLucas}`, cuits);
  }

  enviarDatosExcel(payload: any): Observable<Blob> {
    return this.http.post(this.apiExcel, payload, {
      responseType: 'blob' // CRUCIAL para archivos
    });
  }

  getChequesRechazados(cuit: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/ChequesRechazados/${cuit}`);
  }
}
