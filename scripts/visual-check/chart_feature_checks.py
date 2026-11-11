"""차트의 중립 계열 색, 빈 선택, 통화 눈금과 0 막대를 검증한다."""
from PIL import Image


def contrast(first, second, api):
    def luminance(rgb):
        return sum(api.linear(c) * weight for c, weight in zip(rgb, (.2126, .7152, .0722)))
    low, high = sorted((luminance(first), luminance(second)))
    return (high + .05) / (low + .05)


def distinguishable(delta, ratio):
    return delta >= 15 and ratio >= 3


def check(page, application, output, result, api):
    def capture(key, locator=application):
        path = output / f'{key}.png'
        locator.screenshot(path=str(path), animations='disabled')
        result['captures'].append(str(path))
        return path

    page.set_viewport_size({'width': 1180, 'height': 720})
    colors = ['series-1', 'series-2', 'muted']
    series = [{'key': c, 'name': f'계열 {i + 1}', 'color': c,
               'points': [{'x': month, 'y': values[n]} for n, month in enumerate(['9월', '10월', '11월'])]}
              for i, (c, values) in enumerate(zip(colors, ([52, 61, 70], [20, 18, 26], [9, 14, 11])))]
    for theme in ('light', 'dark'):
        page.emulate_media(color_scheme=theme)
        for order, entries in (('order', series), ('adjacent', [series[0], series[2], series[1]])):
            api.inject(page, {'type': 'chart', 'kind': 'bar', 'stacked': True, 'series': entries})
            measurement = page.evaluate(api.MEASURE_JS, {'appId': api.APP_ID})
            muted_index = next(i for i, entry in enumerate(entries) if entry['color'] == 'muted')
            muted = api.parse_rgb(next(bar['fill'] for bar in measurement['charts'][0]['bars'] if bar['seriesIndex'] == muted_index))
            delta = min(api.de2000(muted, api.parse_rgb(c)) for c in measurement['palette'])
            key = f'muted-{theme}-{order}'
            path = capture(key, application.locator('.ks-chart-frame'))
            # 테두리와 글을 피한 위 안쪽 여백 픽셀로 반투명 틀의 실제 바탕을 잰다.
            with Image.open(path) as image:
                background = image.convert('RGB').getpixel((image.width // 2, 4))
            ratio = contrast(muted, background, api)
            api.record(result, key, {'distinct_and_contrasting': distinguishable(delta, ratio)})
            result['scenes'][key]['measurement'] = {'min_delta_e': delta, 'contrast': ratio, 'background': background}

    page.emulate_media(color_scheme='light')
    for kind in ('bar', 'line', 'area'):
        for mode in ('null', 'value', 'unbound'):
            block = {'type': 'chart', 'kind': kind, 'series': api.single_series()}
            if mode != 'unbound':
                block['selected'] = {'state': 'sel'} if mode == 'null' else api.DAYS[1]
            api.inject(page, block)
            chart = application.locator('.ks-chart')
            graph = chart.locator('.ks-chart-graph')
            marker = chart.locator('.ks-chart-band, .ks-chart-guide')
            resting = marker.count()
            readout = chart.locator('.ks-chart-readout-x').text_content()
            key = f'selection-{kind}-{mode}'
            capture(key)
            graph.focus()
            graph.press('Home')
            moving = marker.count()
            graph.press('Tab')
            after = marker.count()
            api.record(result, key, {'resting': resting == (0 if mode == 'null' else 1),
                'moving': moving == 1, 'after_blur': after == resting,
                'readout': readout == (api.DAYS[1] if mode == 'value' else api.DAYS[-1])})
            result['scenes'][key]['measurement'] = {'resting_markers': resting, 'moving_markers': moving, 'after_blur': after, 'readout': readout}

    for value in (1234.07, 1.23):
        api.inject(page, {'type': 'chart', 'kind': 'bar', 'number_format': {
            'style': 'currency', 'currency': 'USD', 'maximum_fraction_digits': 2},
            'series': [{'key': 's', 'name': '값', 'points': [{'x': '월', 'y': value}]}]})
        ticks = application.locator('.ks-chart-y-axis span').all_text_contents()
        expected = ['$1,600', '$800', '$0'] if value > 2 else ['$1.60', '$0.80', '$0']
        text = '$1,234.07' if value > 2 else '$1.23'
        readout = application.locator('.ks-chart-readout-values').text_content()
        table = application.locator('.ks-chart table').text_content()
        key = f'currency-axis-{value}'
        api.record(result, key, {'ticks': ticks == expected, 'readout_and_table': text in readout and text in table})
        result['scenes'][key]['measurement'] = {'ticks': ticks, 'readout': readout}
        capture(key)

    for stacked in (False, True):
        api.inject(page, {'type': 'chart', 'kind': 'bar', 'stacked': stacked, 'series': [
            {'key': 's', 'name': '값', 'points': [{'x': str(i), 'y': y} for i, y in enumerate([0, .001, -.001, 100])]}]})
        bars = application.locator('.ks-chart-bar').evaluate_all('(bars) => bars.map(b => ({y: +b.getAttribute("y"), height: +b.getAttribute("height")}))')
        key = f'zero-bar-{stacked}'
        api.record(result, key, {'zero_omitted': len(bars) == 3,
            'tiny_signs': len(bars) == 3 and abs(bars[0]['y'] + bars[0]['height'] - 80) < .001 and bars[1]['y'] == 80})
        result['scenes'][key]['measurement'] = bars
        capture(key)
    api.record(result, 'feature-judges-self-check', {
        'rejects_close_color': not distinguishable(6.9, 4),
        'rejects_low_contrast': not distinguishable(17, 2.9),
    })


if __name__ == '__main__':
    from chart_layout_checks import main
    raise SystemExit(main(check))
