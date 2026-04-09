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

  apiUrlLucas = 'http://192.168.2.106:3000/BCRA-debts/';

  private baseUrl = 'https://api.bcra.gob.ar/centraldedeudores/v1.0/Deudas';

  getDeudas(cuit: string): Observable<any> {
    // return this.http.get(`${this.baseUrl}/Historicas/${cuit}`);
    return this.http.get(`${this.apiUrlLucas}${cuit}`);
  }

  getChequesRechazados(cuit: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/ChequesRechazados/${cuit}`);
  }
}
