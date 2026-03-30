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
  private baseUrl = 'https://api.bcra.gob.ar/centraldedeudores/v1.0/Deudas';

  getDeudas(cuit: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/Historicas/${cuit}`);
  }

  getChequesRechazados(cuit: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/ChequesRechazados/${cuit}`);
  }
}
