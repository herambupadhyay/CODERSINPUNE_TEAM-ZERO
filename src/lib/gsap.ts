import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'
import { ScrollToPlugin } from 'gsap/ScrollToPlugin'
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin'
import { useGSAP } from '@gsap/react'

gsap.registerPlugin(ScrollTrigger, SplitText, ScrollToPlugin, DrawSVGPlugin, useGSAP)

gsap.defaults({ ease: 'power3.out', duration: 0.9 })

export { gsap, ScrollTrigger, SplitText, useGSAP }
