# Midea

Controle sus aires acondicionados Midea desde Gladys, en la red local: encendido/apagado, modo, consigna, velocidad del ventilador, oscilación, modos eco, turbo y noche, temperatura interior y exterior, y el consumo de energía de los equipos que lo miden.

> Desarrollada sin el hardware: sus comentarios son bienvenidos («Developed without the hardware: feedback welcome»). Esta integración se escribió y probó con tramas grabadas de equipos reales, no con un aire acondicionado físico. Indique lo que funciona y lo que no en [GitHub](https://github.com/guim31/gladys-midea/issues).

Esta integración no está afiliada a Midea.

## Hardware compatible

El criterio es la aplicación, no la marca del equipo: un aire acondicionado (tipo de aparato Midea `0xAC`) cuyo módulo Wi-Fi esté configurado en una de estas aplicaciones funciona con esta integración:

- **SmartHome / MSmartHome**, **NetHome Plus**, **Midea Air**, **Toshiba AC NA**, **Arctic King**.

Midea fabrica para muchas marcas; los equipos de marcas afines como Comfee, Carrier o algunas gamas de Toshiba suelen usar estas aplicaciones. Los splits, los equipos de ventana y los portátiles hablan todos el mismo protocolo.

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
- **El equipo no responde**: compruebe que tiene corriente y que su dirección no ha cambiado; un módulo solo acepta una conexión a la vez, cierre otras herramientas locales que le hablen.
- **Valores de potencia o energía absurdos**: cambie el **Formato de los datos de energía** a «Binario».
- **Más detalles**: ponga la variable de entorno `LOG_LEVEL` del contenedor en `debug`.

## Limitaciones

- Desarrollada sin el hardware: sus comentarios son bienvenidos en [GitHub](https://github.com/guim31/gladys-midea/issues).
- Solo aires acondicionados: los deshumidificadores y otros aparatos Midea aún no son compatibles.
- Las posiciones de las lamas, la pantalla (LED) y los preajustes avanzados (breeze, iECO, aire fresco...) no se gestionan.
- Los módulos de primera generación (V1) no son compatibles.
- Gladys muestra la consigna en grados enteros en algunas pantallas; el equipo, en cambio, acepta medios grados.
- La clave de un equipo V3 necesita la nube de Midea una vez: si Midea cierra este servicio, los equipos ya conocidos siguen funcionando.
