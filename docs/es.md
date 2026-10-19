# Midea

Controle sus aires acondicionados Midea desde Gladys, en la red local: encendido/apagado, modo, consigna, velocidad del ventilador, oscilación, modos eco, turbo y noche, temperatura interior y exterior, y el consumo de energía de los equipos que lo miden.

> Desarrollada sin el hardware: sus comentarios son bienvenidos («Developed without the hardware: feedback welcome»). Esta integración se escribió y probó con tramas grabadas de equipos reales, no con un aire acondicionado físico. Indique lo que funciona y lo que no en [GitHub](https://github.com/guim31/gladys-midea/issues).

Esta integración no está afiliada a Midea.

## Hardware compatible

El criterio es la aplicación, no la marca del equipo: un aire acondicionado (tipo de aparato Midea `0xAC`) cuyo módulo Wi-Fi esté configurado en una de estas aplicaciones funciona con esta integración:

- **SmartHome / MSmartHome**, **NetHome Plus**, **Midea Air**, **Toshiba AC NA**, **Arctic King**.

Midea fabrica para muchas marcas; los equipos de marcas afines como Comfee, Carrier o algunas gamas de Toshiba suelen usar estas aplicaciones. Los splits, los equipos de ventana y los portátiles hablan todos el mismo protocolo.

Las **bombas de calor aire-agua** (tipo de aparato Midea `0xC3`, el «Heat Pump Wi-Fi Controller» de una bomba de calor hidráulica, por ejemplo el modelo 171H120F) también son compatibles: zonas de calefacción, agua caliente sanitaria, modos eco y silencioso, temperaturas del agua y exterior. Aparecen en la pestaña Descubrir como los aires acondicionados.

No compatibles: los demás aparatos Midea (deshumidificadores, calentadores de agua...), que la búsqueda indica como «no compatible», y los primeros módulos Wi-Fi (protocolo V1, hacia 2015).

## Requisitos

- Gladys **5.2.0** o posterior.
- El aire acondicionado en la misma red local que Gladys, configurado una vez en su aplicación (el módulo Wi-Fi debe estar conectado a su red).
- Para los equipos vendidos desde 2020 aproximadamente (protocolo **V3**): acceso a Internet **una sola vez**, para obtener la clave del equipo en la nube de Midea. Después, todo es local.

## Instalación y configuración

1. En Gladys, abra **Integraciones → Instalar desde GitHub** e introduzca `https://github.com/guim31/gladys-midea`.
2. En la pantalla de instalación, acepte la solicitud de **descubrimiento de red**: Gladys envía la petición de búsqueda de Midea en su red (puertos UDP 6445 y 20086) en nombre de la integración.
3. Abra la pestaña **Configuración** de la integración. Los ajustes:
   - **Direcciones IP de los aires acondicionados**: opcional, solo para los equipos que la búsqueda automática no encuentra (otra subred, un router que filtra las difusiones). Asígneles una dirección fija en su router.
   - **Intervalo de actualización**: frecuencia de lectura de cada equipo (30 segundos por defecto).
   - **Idioma de los nombres de los dispositivos**: idioma de los nombres de los nuevos dispositivos y de sus funciones (francés por defecto).
   - **Pitido en cada orden**: desactivado por defecto, para que una escena nocturna sea silenciosa.
   - **Formato de los datos de energía**: deje «Estándar (BCD)» salvo si la potencia o la energía mostrada es absurda.
   - **Claves de los equipos recientes (V3)**: la **Región de la nube** de la cuenta pública con la que se obtienen las claves (Europa por defecto), o su propia cuenta, en **Cuenta NetHome Plus** y **Contraseña NetHome Plus** (opcionales).
   - **Token y clave introducidos a mano**: opcional, solo para un equipo V3 cuya clave no da la nube (véase más abajo).
4. Abra la pestaña **Descubrir**: cada equipo encontrado aparece con el nombre «Aire acondicionado» seguido de los cuatro últimos caracteres de su nombre Wi-Fi. Añada a Gladys los que desee.

El botón **Buscar aires acondicionados** (pestaña Configuración) inicia una nueva búsqueda y lista cada equipo encontrado, su dirección, su protocolo y si responde.

### Acerca de las claves de los equipos V3

Un equipo V3 solo habla con un cliente que conoce su token y su clave. Midea los guarda en su nube a nombre del propio equipo, no de una cuenta: la integración los obtiene **una sola vez**, con cuentas NetHome Plus públicas (la práctica de las bibliotecas libres msmart-ng y midea-local), o con su propia cuenta si la introduce. Después se guardan en el volumen de la integración (`/data`) y nunca se escriben en los registros. Si el equipo se restablece o se vuelve a emparejar en su aplicación, la integración detecta la clave rechazada y obtiene una nueva.

## Dispositivos y funciones

Cada aire acondicionado es un dispositivo de Gladys. Sus funciones dependen de lo que anuncia el equipo:

| Función                                            | Qué hace                                                                                                   |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Encendido/apagado**                              | Enciende o apaga el equipo.                                                                                |
| **Modo**                                           | Automático, Frío, Calor, Deshumidificación, Solo ventilación (solo los modos del equipo).                  |
| **Temperatura de consigna**                        | La consigna, por medios grados cuando el equipo los acepta, dentro de su rango (de 16 a 30 °C en general). |
| **Velocidad del ventilador**                       | Automática, Silenciosa, Baja, Media, Alta, Máxima (solo las velocidades del equipo).                       |
| **Oscilación vertical**, **Oscilación horizontal** | Oscilación o fija, cuando el equipo tiene la lama.                                                         |
| **Temperatura interior**                           | La temperatura medida por la unidad interior.                                                              |
| **Temperatura exterior**                           | La temperatura medida por la unidad exterior, cuando la indica.                                            |
| **Humedad interior**                               | Cuando el equipo tiene un sensor de humedad.                                                               |
| **Modo eco**, **Turbo**, **Modo noche**            | Los preajustes del equipo. Eco y Turbo se excluyen.                                                        |
| **Potencia consumida**, **Energía consumida**      | Potencia instantánea (W) y energía total (kWh), para los equipos con contador de energía.                  |

Los cambios hechos con el mando o la aplicación se recogen en la lectura siguiente.

### Bombas de calor

Una bomba de calor (tipo `0xC3`) es un dispositivo de Gladys propio, llamado «Bomba de calor» seguido de los cuatro últimos caracteres de su nombre Wi-Fi. Sus funciones siguen la instalación que anuncia (una o dos zonas, agua caliente, solo calefacción o calefacción y refrigeración):

| Función                                                                                         | Qué hace                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Modo zona 1**, **Modo zona 2**                                                                | Apagado, Calor, Frío, Automático: Apagado detiene la zona, los demás valores fijan el modo de funcionamiento de la bomba de calor, común a las dos zonas. Zona 2 solo con dos zonas.                                                                   |
| **Consigna zona 1**, **Consigna zona 2**                                                        | La temperatura del agua de la zona (grados enteros), o la temperatura de la estancia para una zona con termostato de ambiente (por medios grados), dentro de los límites que anuncia el equipo.                                                        |
| **Agua caliente**, **Consigna de agua caliente**                                                | Agua caliente sanitaria encendida o apagada, y su consigna dentro de los límites del equipo.                                                                                                                                                           |
| **Temperatura del depósito**                                                                    | La temperatura medida en el depósito.                                                                                                                                                                                                                  |
| **Temperatura exterior**, **Temperatura de entrada de agua**, **Temperatura de salida de agua** | Medidas por las unidades exterior e hidráulica, cuando el equipo las da.                                                                                                                                                                               |
| **Funcionamiento zona 1**, **Funcionamiento zona 2**                                            | Reposo, calefacción o refrigeración: lo que hace la zona en este momento (reposo cuando está apagada o mientras el equipo calienta el agua).                                                                                                           |
| **Curva climática zona 1**, **Curva climática zona 2**                                          | La consigna del agua de la zona sigue la temperatura exterior (la curva ajustada en el mando).                                                                                                                                                         |
| **Calentamiento del agua**                                                                      | El equipo está calentando el agua caliente en este momento.                                                                                                                                                                                            |
| **Caudal de agua**, **Presión del agua**                                                        | Caudal del circuito de calefacción (m³/h) y su presión (kPa).                                                                                                                                                                                          |
| **Modo eco**, **Modo silencioso**, **Modo súper silencioso**                                    | Los preajustes del equipo. El modo súper silencioso es el nivel más discreto del modo silencioso, cuando el equipo lo ofrece.                                                                                                                          |
| **Compresor**, **Desescarche**, **Apoyo eléctrico**                                             | Si el compresor funciona, la unidad exterior desescarcha, una resistencia eléctrica (apoyo o depósito) ayuda.                                                                                                                                          |
| **Horas del compresor**                                                                         | Horas de funcionamiento del compresor: aparecen en cuanto el equipo las ha enviado.                                                                                                                                                                    |
| **Código de error**                                                                             | El código que muestra el mando (E8, P1, H6...), o «Sin errores». El disparador «Error del equipo» lo da en `error_display`.                                                                                                                            |
| **Potencia consumida**                                                                          | La potencia instantánea (W), cuando el equipo la da.                                                                                                                                                                                                   |
| **Energía consumida**, **Calor producido (kWh)**                                                | La electricidad consumida y el calor producido en total (kWh): aparecen en cuanto el equipo ha enviado sus contadores. Su relación da el rendimiento estacional (COP). El calor es un simple contador, para que Gladys no lo cuente como electricidad. |

La resistencia de apoyo del depósito, el agua caliente rápida y la desinfección antilegionela quedan en manos del equipo y de su mando. El widget «Aire acondicionado» y la acción de escena «Poner en marcha el aire» son solo para aires acondicionados; el disparador «Error del equipo» funciona también para las bombas de calor. La compatibilidad con las bombas de calor se escribió a partir del código de midea-local y espera comentarios sobre equipos reales.

## Widget

El widget **Aire acondicionado** (elija el equipo en su configuración) muestra la temperatura de la estancia, la consigna y la temperatura exterior (o la humedad), y después el modo, el ventilador, el estado del filtro y el código de error del equipo. Sus botones:

- **Encender** / **Apagar**;
- **−0,5 °C** y **+0,5 °C** (de 1 °C en 1 °C en los equipos que no aceptan medios grados);
- **Modo y ventilador**: un pequeño formulario para elegir a la vez el modo y la velocidad del ventilador; el equipo se enciende.

## Disparadores de escena

- **Filtro por limpiar**: el equipo pide la limpieza de su filtro. Útil para enviarse un mensaje.
- **Error del equipo**: el equipo indica un nuevo código de error. El código está disponible en la escena como variable (`error_code`), para ponerlo en un mensaje.

## Acción de escena

- **Poner en marcha el aire**: enciende el equipo con su modo, su consigna y su ventilador en **una sola** orden (un solo pitido, sin estado intermedio), donde las acciones estándar de Gladys enviarían una orden por función. Un campo vacío conserva el ajuste actual. La consigna acepta medios grados (`24,5` o `24.5`). La consigna aplicada se devuelve a la escena.

Para apagar el equipo, o cambiar un solo ajuste, utilice la acción estándar «Controlar un dispositivo» de Gladys.

## Ejemplos de escenas

- **Refrescar el dormitorio antes de dormir**: a las 21:30, si el dormitorio supera los 26 °C, «Poner en marcha el aire» en Frío a 24 °C, ventilador Silenciosa, y después activar el Modo noche.
- **Nadie en casa**: cuando sale la última persona, apagar todos los aires acondicionados.
- **Recordatorio del filtro**: con «Filtro por limpiar», enviar el mensaje «Limpiar el filtro del aire del salón».
- **Alerta de avería**: con «Error del equipo», enviar un mensaje con el código de error (`error_code`).

## Actualización y red

- La integración lee ella misma cada equipo cada 30 segundos por defecto, por la red local (puerto TCP 6444). El sondeo de Gladys solo sirve de respaldo. Cada lectura son unas pocas tramas pequeñas: sin Internet, sin cuota.
- Solo se envían a Gladys los valores que cambian, más un recordatorio cada 6 horas para que un valor estable nunca parezca antiguo.
- Cada 30 minutos se realiza una nueva búsqueda, para seguir a un equipo cuya dirección ha cambiado.
- La nube de Midea solo se contacta para obtener la clave de un equipo V3 que aún no la tiene.

## Solución de problemas

- **No se encuentra ningún equipo**: compruebe que está conectado en su aplicación y en la misma red que Gladys; introduzca su dirección IP en la configuración; ejecute **Buscar aires acondicionados**.
- **«Un equipo reciente (V3) no tiene clave»**: Gladys no ha podido contactar con la nube de Midea, o la cuenta pública de la región no conoce el equipo. Pruebe otra **Región de la nube**, o introduzca su propia cuenta NetHome Plus, y vuelva a ejecutar **Buscar aires acondicionados**.
- **La nube no da clave** (algunas bombas de calor): si la integración Midea AC LAN de Home Assistant ya se comunica con el equipo, copie su token y su clave (en su configuración guardada) en **Token y clave introducidos a mano**, con la forma `token:clave`, y vuelva a ejecutar **Buscar aires acondicionados**.
- **El equipo no responde**: compruebe que tiene corriente y que su dirección no ha cambiado; un módulo solo acepta una conexión a la vez, cierre otras herramientas locales que le hablen.
- **Valores de potencia o energía absurdos**: cambie el **Formato de los datos de energía** a «Binario».
- **Más detalles**: ponga la variable de entorno `LOG_LEVEL` del contenedor en `debug`.

## Limitaciones

- Desarrollada sin el hardware: sus comentarios son bienvenidos en [GitHub](https://github.com/guim31/gladys-midea/issues).
- Solo aires acondicionados y bombas de calor aire-agua: los deshumidificadores y otros aparatos Midea aún no son compatibles.
- Las posiciones de las lamas, la pantalla (LED) y los preajustes avanzados (breeze, iECO, aire fresco...) no se gestionan.
- Los módulos de primera generación (V1) no son compatibles.
- Gladys muestra la consigna en grados enteros en algunas pantallas; el equipo, en cambio, acepta medios grados.
- La clave de un equipo V3 necesita la nube de Midea una vez: si Midea cierra este servicio, los equipos ya conocidos siguen funcionando.
