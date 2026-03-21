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
  private readonly URL_BASE = '/api-bcra/centraldedeudores/v1.0/Deudas/Historicas';

  getDeudas(cuit: string): Observable<any> {
    const cuitLimpio = cuit.trim();
    // Esto garantiza: /api-bcra/centraldedeudores/v1.0/Deudas/Historicas/20281199537
    const urlFinal = `${this.URL_BASE}/${cuitLimpio}`;
    console.log('Llamando a:', urlFinal); // Verificá esto en la consola
    return this.http.get(urlFinal);
  }
}
